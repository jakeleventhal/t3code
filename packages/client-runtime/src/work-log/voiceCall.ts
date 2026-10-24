import type {
  OrchestrationV2TurnItem,
  ThreadId,
  VoiceCallEndReason,
  VoiceCallSummary,
  VoiceTranscriptEntry,
  VoiceTranscriptPage,
  VoiceTranscriptPageInput,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

export type VoiceCallTurnItem = Extract<OrchestrationV2TurnItem, { readonly type: "voice_call" }>;

export function formatVoiceCallDuration(startedAt: string, endedAt: string): string | null {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

export function voiceCallEndLabel(reason: VoiceCallEndReason | null): string | null {
  switch (reason) {
    case null:
    case "user":
      return null;
    case "bot":
      return "Ended by the bot";
    case "interrupted":
      return "Interrupted";
    case "error":
      return "Call failed";
    case "replaced":
      return "Ended for another call";
  }
}

/** A call still on the line says so without a running clock; its duration exists only once it ends. */
export function voiceCallStatusLabel(call: VoiceCallSummary): string {
  if (call.endedAt === null) return "Ongoing";
  return [formatVoiceCallDuration(call.startedAt, call.endedAt), voiceCallEndLabel(call.endReason)]
    .filter(Boolean)
    .join(" · ");
}

export interface VoiceTranscriptPageRead<E> {
  readonly input: VoiceTranscriptPageInput;
  readonly result: AsyncResult.AsyncResult<VoiceTranscriptPage, E>;
}

/**
 * Reads at most `pageCount` pages, each continuing from the previous page's cursor. The walk
 * stops at the first page without fresh data, so a later page is never requested from a cursor
 * that is missing or came from a read that has since failed.
 */
export function readVoiceTranscriptPages<E>(
  target: { readonly threadId: ThreadId; readonly callId: string; readonly pageCount: number },
  read: (input: VoiceTranscriptPageInput) => AsyncResult.AsyncResult<VoiceTranscriptPage, E>,
): ReadonlyArray<VoiceTranscriptPageRead<E>> {
  const pages: VoiceTranscriptPageRead<E>[] = [];
  let afterOrdinal: number | undefined;
  for (let index = 0; index < target.pageCount; index += 1) {
    const input: VoiceTranscriptPageInput =
      afterOrdinal === undefined
        ? { threadId: target.threadId, callId: target.callId }
        : { threadId: target.threadId, callId: target.callId, afterOrdinal };
    const result = read(input);
    pages.push({ input, result });
    if (result._tag !== "Success" || result.value.nextOrdinal === null) break;
    afterOrdinal = result.value.nextOrdinal;
  }
  return pages;
}

/**
 * Pages to read again when a card opens or its call ends while open, since cached words may
 * predate the call's end or later finalization. An open skips a page still on its first read,
 * which is already fresh; an end re-reads it too, since that read may have started before it.
 */
export function voiceTranscriptPagesToRefresh<E>(
  pages: ReadonlyArray<VoiceTranscriptPageRead<E>>,
  reason: "open" | "end",
): ReadonlyArray<VoiceTranscriptPageInput> {
  return pages
    .filter(({ result }) => reason === "end" || !result.waiting)
    .map(({ input }) => input);
}

export type VoiceTranscriptHistory<E> = {
  readonly entries: ReadonlyArray<VoiceTranscriptEntry>;
  /** True once the last read page says nothing follows it. */
  readonly complete: boolean;
} & (
  | { readonly status: "loading" | "ready" }
  /** Only the failed page is retried; its last good rows and the pages before it stay. */
  | {
      readonly status: "error";
      readonly cause: Cause.Cause<E>;
      readonly retry: VoiceTranscriptPageInput;
    }
);

export function mergeVoiceTranscriptPages<E>(
  pages: ReadonlyArray<VoiceTranscriptPageRead<E>>,
): VoiceTranscriptHistory<E> {
  const byId = new Map<string, VoiceTranscriptEntry>();
  const collect = (entries: ReadonlyArray<VoiceTranscriptEntry>) => {
    for (const entry of entries) {
      const previous = byId.get(entry.id);
      if (previous === undefined || entry.revision >= previous.revision) byId.set(entry.id, entry);
    }
  };
  const entries = () => [...byId.values()].sort((left, right) => left.ordinal - right.ordinal);
  for (const { input, result } of pages) {
    const page = Option.getOrNull(AsyncResult.value(result));
    if (page !== null) collect(page.entries);
    // A retry in flight is loading, not a failure still waiting for the user.
    if (result._tag === "Failure" && !result.waiting) {
      return {
        entries: entries(),
        complete: false,
        status: "error",
        cause: result.cause,
        retry: input,
      };
    }
    if (result._tag !== "Success") {
      return { entries: entries(), complete: false, status: "loading" };
    }
  }
  const last = pages.at(-1);
  // Nothing read yet is not an empty transcript.
  if (last === undefined) return { entries: [], complete: false, status: "loading" };
  const lastPage = Option.getOrNull(AsyncResult.value(last.result));
  return { entries: entries(), complete: lastPage?.nextOrdinal === null, status: "ready" };
}
