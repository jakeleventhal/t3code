import * as Schema from "effect/Schema";
import { VoiceConnectionError, VoiceCallError } from "@t3tools/contracts";
import { VoiceCallSetupError } from "./controller.ts";
// @effect-diagnostics globalTimers:off - Preview-only sessions have a hard lifetime cap; Live has no audio-completed event.
import {
  VOICE_PREVIEW_TEXT,
  type VoicePreviewInput,
  type VoicePreviewResult,
  type VoiceSelection,
} from "@t3tools/contracts";
import type { LiveMediaInput, openLiveMedia } from "./live-media.ts";

const isVoiceSetupError = Schema.is(Schema.Union([VoiceConnectionError, VoiceCallError]));

/** No microphone, conversation context, work tools, transcript persistence, or settings writes. */
export async function playVoicePreview(input: {
  readonly selection: VoiceSelection;
  readonly kind: "openai-api" | "codex-subscription" | "xai-api";
  readonly signal: AbortSignal;
  readonly negotiate: (input: VoicePreviewInput) => Promise<VoicePreviewResult>;
  readonly openMedia: (input: LiveMediaInput) => ReturnType<typeof openLiveMedia>;
  readonly playAudio: (uri: string, signal: AbortSignal) => Promise<void>;
}) {
  input.signal.throwIfAborted();
  if (input.kind === "xai-api") {
    const result = await input.negotiate({ selection: input.selection });
    input.signal.throwIfAborted();
    if (result.kind !== "audio")
      throw new Error(
        "The host returned an incompatible voice preview. Update T3 Code on the host.",
      );
    await input.playAudio(result.dataUri, input.signal);
    return;
  }
  const abort = new AbortController();
  const stop = () => abort.abort();
  input.signal.addEventListener("abort", stop, { once: true });
  let failure: string | null = null;
  if (input.signal.aborted) stop();
  let close: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const media = await input.openMedia({
      signal: abort.signal,
      playbackOnly: true,
      negotiate: async (sdp) => {
        const result = await input
          .negotiate({ selection: input.selection, sdp })
          .catch((error: unknown) => {
            if (isVoiceSetupError(error)) throw new VoiceCallSetupError(error.message);
            throw error;
          });
        if (result.kind !== "webrtc")
          throw new Error("The host returned an incompatible voice preview.");
        return result;
      },
      callbacks: {
        onTranscript: () => {},
        onDelegation: () => {},
        onClosed: stop,
        onFailure: (message) => {
          failure = message;
          stop();
        },
      },
    });
    close = media.close;
    input.signal.throwIfAborted();
    if (failure !== null) throw new Error(failure);
    await media.session.appendContext({ text: `Say exactly: ${VOICE_PREVIEW_TEXT}`, speak: true });
    // A short sample must not leave a billable full-duplex session idle indefinitely.
    await new Promise<void>((resolve) => {
      if (abort.signal.aborted) return resolve();
      abort.signal.addEventListener("abort", () => resolve(), { once: true });
      timer = setTimeout(() => {
        stop();
        resolve();
      }, 15_000);
    });
    if (failure !== null) throw new Error(failure);
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", stop);
    stop();
    await close?.();
  }
}
