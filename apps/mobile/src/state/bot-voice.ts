import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { createBotVoiceEnvironmentAtoms } from "@t3tools/client-runtime/state/bot-voice";
import {
  mergeVoiceTranscriptPages,
  readVoiceTranscriptPages,
  voiceTranscriptPagesToRefresh,
  type VoiceTranscriptPageRead,
} from "@t3tools/client-runtime/work-log/voice-call";
import type { EnvironmentId, ThreadId, VoiceTranscriptEntry } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { formatEnvironmentQueryError } from "./query";

export const botVoiceEnvironment = createBotVoiceEnvironmentAtoms(connectionAtomRuntime);

export interface VoiceCallTranscriptView {
  readonly entries: ReadonlyArray<VoiceTranscriptEntry>;
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

const NO_TRANSCRIPT_PAGES = Atom.make<ReadonlyArray<VoiceTranscriptPageRead<never>>>([]);

/**
 * A call's words, a bounded page at a time. Nothing is requested until `target` is set, so a
 * collapsed card costs nothing; pages already read stay put while a later one loads or retries.
 * Cached words are re-read once each time the card opens and when the call ends while open.
 */
export function useVoiceCallTranscript(
  target: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly callId: string;
    readonly ended: boolean;
  } | null,
): VoiceCallTranscriptView {
  const registry = useContext(RegistryContext);
  const [pageCount, setPageCount] = useState(1);
  const environmentId = target?.environmentId ?? null;
  const threadId = target?.threadId ?? null;
  const callId = target?.callId ?? null;
  const ended = target?.ended ?? false;
  const pagesAtom = useMemo(
    () =>
      environmentId === null || threadId === null || callId === null
        ? NO_TRANSCRIPT_PAGES
        : Atom.make((get) =>
            readVoiceTranscriptPages({ threadId, callId, pageCount }, (input) =>
              get(botVoiceEnvironment.transcriptPage({ environmentId, input })),
            ),
          ),
    [environmentId, threadId, callId, pageCount],
  );
  // Acts when the card opens or its call ends, not when another page is added.
  const lastSync = useRef<{ readonly key: string; readonly ended: boolean } | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- Refresh persisted transcript pages when a call opens or ends outside this component.
  useEffect(() => {
    if (environmentId === null || threadId === null || callId === null) {
      lastSync.current = null;
      return;
    }
    const key = JSON.stringify([environmentId, threadId, callId]);
    const previous = lastSync.current;
    if (previous?.key === key && previous.ended === ended) return;
    lastSync.current = { key, ended };
    const reason = previous?.key === key ? "end" : "open";
    for (const input of voiceTranscriptPagesToRefresh(registry.get(pagesAtom), reason)) {
      registry.refresh(botVoiceEnvironment.transcriptPage({ environmentId, input }));
    }
  }, [environmentId, threadId, callId, ended, pagesAtom, registry]);
  const history = mergeVoiceTranscriptPages(useAtomValue(pagesAtom));
  return {
    entries: history.entries,
    status: history.status,
    error: history.status === "error" ? formatEnvironmentQueryError(history.cause) : null,
    hasMore: history.status === "ready" && !history.complete,
    loadMore: () => setPageCount((count) => count + 1),
    retry: () => {
      if (history.status !== "error" || environmentId === null) return;
      registry.refresh(botVoiceEnvironment.transcriptPage({ environmentId, input: history.retry }));
    },
  };
}
