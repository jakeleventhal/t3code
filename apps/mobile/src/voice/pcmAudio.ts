import {
  createPcmPlaybackLevels,
  pcm16Base64Level,
} from "@t3tools/client-runtime/voice-call/audio-levels";
import type {
  PcmAudioFactory,
  PcmPlaybackPosition,
} from "@t3tools/client-runtime/voice-call/pcm-audio";
import { requireOptionalNativeModule } from "expo";

import { uuidv4 } from "../lib/uuid";
import { callAudioLevels } from "./callAudioLevels";

interface VoiceAudioEvents {
  readonly onAudio: (event: { readonly sessionId: string; readonly data: string }) => void;
  readonly onPlaybackIdle: (event: { readonly sessionId: string }) => void;
  readonly onError: (event: { readonly sessionId: string; readonly message: string }) => void;
}

/** `modules/t3-voice-audio`. Every call names its session; native ignores any other session's. */
interface NativeVoiceAudio {
  begin(sessionId: string): void;
  start(sessionId: string, sampleRate: number): Promise<void>;
  enqueue(sessionId: string, base64: string, itemId: string): void;
  clear(sessionId: string): PcmPlaybackPosition | null;
  setMuted(sessionId: string, muted: boolean): void;
  stop(sessionId: string): void;
  addListener<Name extends keyof VoiceAudioEvents>(
    name: Name,
    listener: VoiceAudioEvents[Name],
  ): { remove(): void };
}

const CANCELLED = "The voice audio was cancelled.";
/** A microphone chunk older than this no longer describes what is being said. */
const MICROPHONE_LEVEL_STALE_MS = 200;

/** PCM16 frames in a base64 chunk, without decoding it. */
function base64Frames(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(((base64.length * 3) / 4 - padding) / 2);
}

let nativeModule: NativeVoiceAudio | null | undefined;
function nativeVoiceAudio(): NativeVoiceAudio | null {
  nativeModule ??= requireOptionalNativeModule<NativeVoiceAudio>("T3VoiceAudio");
  return nativeModule;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/**
 * Echo-cancelled microphone capture and reply playback through the platform voice-call audio
 * path. Audio crosses the bridge as base64 and is never written anywhere.
 */
export const createNativePcmAudio: PcmAudioFactory = (input) => {
  const native = nativeVoiceAudio();
  const sessionId = uuidv4();
  let phase: "idle" | "starting" | "started" | "closed" = "idle";
  let muted = false;
  // A native failure while starting becomes start()'s rejection rather than a second report.
  let setupFailure: string | null = null;
  const isClosed = () => phase === "closed";
  // Native plays replies on its own clock, so their loudness follows the schedule JS queued them on.
  const playbackLevels = createPcmPlaybackLevels();
  let microphoneChunk = { base64: "", at: 0 };
  let detachLevels = () => {};

  const subscriptions =
    native === null
      ? []
      : [
          native.addListener("onAudio", (event) => {
            if (event.sessionId !== sessionId || isClosed()) return;
            microphoneChunk = { base64: event.data, at: Date.now() };
            input.onAudio(event.data);
          }),
          native.addListener("onPlaybackIdle", (event) => {
            if (event.sessionId !== sessionId || isClosed()) return;
            playbackLevels.clear();
            input.onPlaybackIdle();
          }),
          native.addListener("onError", (event) => {
            if (event.sessionId === sessionId) fail(event.message);
          }),
        ];

  function close() {
    if (isClosed()) return;
    const reserved = phase !== "idle";
    phase = "closed";
    input.signal.removeEventListener("abort", close);
    detachLevels();
    for (const subscription of subscriptions) subscription.remove();
    if (reserved) native?.stop(sessionId);
  }

  function fail(message: string) {
    if (isClosed()) return;
    const starting = phase === "starting";
    close();
    if (starting) setupFailure = message;
    else input.onError(message);
  }

  input.signal.addEventListener("abort", close, { once: true });
  if (input.signal.aborted) close();

  return {
    start: async () => {
      if (isClosed()) throw new Error(CANCELLED);
      if (phase !== "idle") throw new Error("The voice audio already started.");
      if (native === null) {
        close();
        throw new Error("This version of T3 Code can't place voice calls. Update the app to call.");
      }
      phase = "starting";
      // Reserved synchronously, so a close before the native start lands still cancels it.
      native.begin(sessionId);
      try {
        await native.start(sessionId, input.sampleRate);
      } catch (error) {
        const message = setupFailure ?? messageOf(error, "The microphone couldn't start.");
        close();
        throw new Error(message, { cause: error });
      }
      if (isClosed()) throw new Error(setupFailure ?? CANCELLED);
      phase = "started";
      if (muted) native.setMuted(sessionId, true);
      detachLevels = callAudioLevels.attach(() => {
        const now = Date.now();
        return {
          microphone:
            muted || now - microphoneChunk.at > MICROPHONE_LEVEL_STALE_MS
              ? 0
              : pcm16Base64Level(microphoneChunk.base64),
          speaker: playbackLevels.levelAt(now),
        };
      });
    },
    enqueue: (base64, itemId) => {
      if (isClosed() || native === null) return;
      try {
        native.enqueue(sessionId, base64, itemId);
        playbackLevels.push(
          () => pcm16Base64Level(base64),
          (base64Frames(base64) / input.sampleRate) * 1000,
          Date.now(),
        );
      } catch (error) {
        fail(messageOf(error, "The voice reply couldn't be played."));
      }
    },
    clear: () => {
      if (phase !== "started" || native === null) return null;
      try {
        const position = native.clear(sessionId);
        playbackLevels.clear();
        // Truncation must never claim audio the user did not hear.
        return position === null
          ? null
          : { itemId: position.itemId, playedMs: Math.max(0, Math.floor(position.playedMs)) };
      } catch (error) {
        fail(messageOf(error, "The voice reply couldn't be stopped."));
        return null;
      }
    },
    setMuted: (next) => {
      if (isClosed()) return;
      muted = next;
      if (phase === "started") native?.setMuted(sessionId, next);
    },
    close,
  };
};
