// @effect-diagnostics globalTimers:off - This client-owned batch deadline runs only while transcript updates are pending.
import type {
  VoiceCallConnection,
  VoiceCallConnector,
  VoiceCallEndReason,
  VoiceCallTranscriptEntry,
} from "./controller.ts";

export interface VoiceCallWriter {
  readonly callId?: string;
  readonly endpointId?: string;
  readonly append: (entries: ReadonlyArray<VoiceCallTranscriptEntry>) => Promise<void>;
  readonly end: (
    reason: VoiceCallEndReason,
    entries: ReadonlyArray<VoiceCallTranscriptEntry>,
  ) => Promise<void>;
}

const BATCH_SIZE = 32;
const BATCH_DELAY_MS = 200;
const SYNC_ERROR = "Audio stopped because the conversation could not be saved.";

class TranscriptJournal {
  private readonly writer: VoiceCallWriter;
  private readonly onFailure: () => void;
  private readonly pending = new Map<string, VoiceCallTranscriptEntry>();
  private readonly versions = new Map<string, { revision: number; final: boolean }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail = Promise.resolve();
  private failed = false;
  private draining = false;
  private ending = false;

  constructor(writer: VoiceCallWriter, onFailure: () => void) {
    this.writer = writer;
    this.onFailure = onFailure;
  }

  append(entry: VoiceCallTranscriptEntry): void {
    if (this.ending) return;
    const previous = this.versions.get(entry.id);
    if (previous && (previous.revision >= entry.revision || (previous.final && !entry.final)))
      return;
    this.versions.set(entry.id, { revision: entry.revision, final: entry.final });
    this.pending.set(entry.id, entry);
    if (this.timer !== null || this.failed || this.draining) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tail = this.tail
        .then(() => this.drain(0))
        .catch(() => {
          // Keep unacknowledged rows for the final write, but do not keep recording
          // or retrying in the background after losing the conversation store.
          this.failed = true;
          this.onFailure();
        });
    }, BATCH_DELAY_MS);
  }

  pause(): void {
    this.draining = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async end(reason: VoiceCallEndReason): Promise<void> {
    this.pause();
    this.ending = true;
    await this.tail;
    // Another device or a server restart may already have ended the record.
    // Only finalization accepts that old endpoint's remaining transcript pages.
    await this.drain(
      BATCH_SIZE,
      reason === "replaced" || reason === "interrupted" ? reason : undefined,
    );
    const last = this.batch();
    // The last transcript page and the ended card commit together on the server.
    await this.writer.end(reason, last);
    this.pending.clear();
  }

  private batch(): ReadonlyArray<VoiceCallTranscriptEntry> {
    return [...this.pending.values()].sort((a, b) => a.ordinal - b.ordinal).slice(0, BATCH_SIZE);
  }

  private async drain(leave: number, endedReason?: VoiceCallEndReason): Promise<void> {
    while (this.pending.size > (this.draining ? Math.max(leave, BATCH_SIZE) : leave)) {
      const batch = this.batch();
      if (endedReason === undefined) await this.writer.append(batch);
      else await this.writer.end(endedReason, batch);
      for (const entry of batch) {
        // A correction may have arrived while its preceding revision was saving.
        if (this.pending.get(entry.id) === entry) this.pending.delete(entry.id);
      }
    }
  }
}

function abortReason(signal: AbortSignal): VoiceCallEndReason {
  switch (signal.reason) {
    case "user":
    case "bot":
    case "error":
    case "replaced":
      return signal.reason;
    default:
      return "interrupted";
  }
}

/** Bind a client media adapter to one environment-authorized call record. */
export function persistVoiceCalls(input: {
  readonly media: VoiceCallConnector;
  /** Must resolve only after the call is committed; a rejection must never open the microphone. */
  readonly begin: (
    call: Pick<Parameters<VoiceCallConnector["connect"]>[0], "callId" | "target" | "signal">,
  ) => Promise<VoiceCallWriter>;
}): VoiceCallConnector {
  return {
    async connect(call) {
      call.signal.throwIfAborted();
      const writer = await input.begin(call);
      const connectedCall = {
        ...call,
        callId: writer.callId ?? call.callId,
        ...(writer.endpointId === undefined ? {} : { endpointId: writer.endpointId }),
      };
      if (connectedCall.callId !== call.callId)
        call.onEvent({ type: "identity", callId: connectedCall.callId });
      if (call.signal.aborted) {
        await writer.end(abortReason(call.signal), []);
        call.signal.throwIfAborted();
      }
      const mediaAbort = new AbortController();
      let media: Promise<VoiceCallConnection>;
      let closing: Promise<void> | null = null;
      let endReason: VoiceCallEndReason | null = null;
      let ended = false;
      const journal = new TranscriptJournal(writer, () => {
        mediaAbort.abort("error");
        call.onEvent({ type: "failed", message: SYNC_ERROR });
        void close("error").catch(() => undefined);
      });
      const close = (requestedReason: VoiceCallEndReason): Promise<void> => {
        endReason ??= requestedReason;
        const reason = endReason;
        journal.pause();
        mediaAbort.abort(reason);
        closing ??= (async () => {
          let mediaFailed = false;
          let connection: VoiceCallConnection | undefined;
          try {
            connection = await media;
          } catch {
            // Cancellation during setup has no open transport left to drain.
            mediaFailed = reason === "error";
          }
          try {
            await connection?.close(reason);
          } catch {
            mediaFailed = true;
          }
          try {
            // Aborting stops audio now. Keep accepting transcript finals until
            // the media adapter has finished draining its control channel.
            await journal.end(mediaFailed && reason !== "replaced" ? "error" : reason);
          } finally {
            ended = true;
            call.signal.removeEventListener("abort", abort);
          }
          if (mediaFailed) throw new Error("The voice connection could not finish syncing.");
        })();
        return closing;
      };
      const abort = () => {
        void close(abortReason(call.signal)).catch(() => undefined);
      };
      // Defer adapter entry so even a synchronous callback can safely close this call.
      media = Promise.resolve().then(() => {
        mediaAbort.signal.throwIfAborted();
        return input.media.connect({
          ...connectedCall,
          signal: mediaAbort.signal,
          onEvent: (event) => {
            if (ended) return;
            if (event.type === "transcript") journal.append(event.entry);
            call.onEvent(event);
            if (event.type === "ended") void close(event.reason).catch(() => undefined);
            if (event.type === "failed") void close("error").catch(() => undefined);
          },
        });
      });
      call.signal.addEventListener("abort", abort, { once: true });
      if (call.signal.aborted) abort();
      try {
        const connection = await media;
        if (mediaAbort.signal.aborted) {
          await close(abortReason(mediaAbort.signal));
          mediaAbort.signal.throwIfAborted();
        }
        return {
          close,
          setMuted: (muted) => connection.setMuted(muted),
          ...(connection.sendText
            ? { sendText: (text: string) => connection.sendText!(text) }
            : {}),
        };
      } catch (error) {
        await close(call.signal.aborted ? abortReason(call.signal) : "error");
        throw error;
      }
    },
  };
}
