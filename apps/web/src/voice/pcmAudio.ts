import {
  createPcmPlaybackLevels,
  pcm16Level,
} from "@t3tools/client-runtime/voice-call/audio-levels";
import type {
  PcmAudio,
  PcmAudioFactory,
  PcmPlaybackPosition,
} from "@t3tools/client-runtime/voice-call/pcm-audio";

import { callAudioLevels } from "./callAudioLevels";

const CAPTURE_PROCESSOR = "t3-pcm-capture";
const CAPTURE_CHUNK_MS = 40;
/** Jitter cushion when playback starts from silence; contiguous chunks play back to back. */
const PLAYBACK_LEAD_SECONDS = 0.05;
/** Replies arrive faster than real time; past this much unplayed audio the call fails instead of growing. */
const MAX_QUEUED_PLAYBACK_SECONDS = 180;
/** A microphone chunk older than this no longer describes what is being said. */
const MICROPHONE_LEVEL_STALE_MS = 4 * CAPTURE_CHUNK_MS;

/**
 * Inline so there is no separate asset to resolve: the same Blob URL loads under Vite dev, bundled
 * builds, the desktop app, and the hosted app at any base path.
 *
 * Firefox can't connect a microphone to a context at another sample rate, so capture runs at the
 * device rate and downsamples here with a windowed-sinc low-pass, then emits PCM16 LE chunks.
 */
const CAPTURE_WORKLET_SOURCE = `
const ZERO_CROSSINGS = 16;
const TABLE_RESOLUTION = 128;
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { outputRate, chunkFrames } = options.processorOptions;
    const cutoff = 0.9 * Math.min(1, outputRate / sampleRate);
    const half = Math.ceil(ZERO_CROSSINGS / cutoff);
    const table = new Float32Array(half * TABLE_RESOLUTION + 2);
    for (let i = 0; i < table.length; i++) {
      const x = i / TABLE_RESOLUTION;
      if (x >= half) break;
      const t = Math.PI * cutoff * x;
      const w = Math.PI * x / half;
      table[i] = cutoff * (x === 0 ? 1 : Math.sin(t) / t) * (0.42 + 0.5 * Math.cos(w) + 0.08 * Math.cos(2 * w));
    }
    this.table = table;
    this.half = half;
    this.step = sampleRate / outputRate;
    this.input = new Float32Array(4 * half + 512);
    this.length = half;
    this.position = half;
    this.chunkFrames = chunkFrames;
    this.chunk = new DataView(new ArrayBuffer(chunkFrames * 2));
    this.chunkLength = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    if (this.length + channel.length > this.input.length) {
      const grown = new Float32Array((this.length + channel.length) * 2);
      grown.set(this.input.subarray(0, this.length));
      this.input = grown;
    }
    this.input.set(channel, this.length);
    this.length += channel.length;
    const { input, table, half } = this;
    while (Math.floor(this.position) + half < this.length) {
      const center = Math.floor(this.position);
      const fraction = this.position - center;
      let sum = 0;
      for (let k = 1 - half; k <= half; k++) {
        const scaled = Math.abs(k - fraction) * TABLE_RESOLUTION;
        const index = scaled | 0;
        sum += input[center + k] * (table[index] + (table[index + 1] - table[index]) * (scaled - index));
      }
      const sample = sum > 1 ? 1 : sum < -1 ? -1 : sum;
      this.chunk.setInt16(this.chunkLength * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
      if (++this.chunkLength === this.chunkFrames) {
        const bytes = this.chunk.buffer;
        this.port.postMessage(bytes, [bytes]);
        this.chunk = new DataView(new ArrayBuffer(this.chunkFrames * 2));
        this.chunkLength = 0;
      }
      this.position += this.step;
    }
    const consumed = Math.floor(this.position) - half + 1;
    if (consumed > 0) {
      input.copyWithin(0, consumed, this.length);
      this.length -= consumed;
      this.position -= consumed;
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR)}, PcmCapture);
`;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodePcm16(base64: string): Float32Array<ArrayBuffer> | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length % 2 !== 0) return null;
  const samples = new Float32Array(binary.length / 2);
  for (let index = 0; index < samples.length; index++) {
    const value = binary.charCodeAt(index * 2) | (binary.charCodeAt(index * 2 + 1) << 8);
    samples[index] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}

function sampleLevel(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function microphoneError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : null;
  if (name === "NotAllowedError" || name === "SecurityError")
    return new Error("Microphone access was blocked. Allow it in your browser to call.");
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new Error("No microphone was found.");
  if (name === "NotReadableError") return new Error("The microphone is in use by another app.");
  return new Error("The microphone could not start.");
}

interface PlaybackSegment {
  readonly itemId: string;
  readonly source: AudioBufferSourceNode;
  readonly start: number;
  readonly durationMs: number;
  /** Audio of this item scheduled before the segment. */
  readonly itemOffsetMs: number;
}

/**
 * Microphone audio streams out as base64 PCM16 and replies play from memory; nothing is recorded.
 * Playback runs in a context at the PCM rate, so the browser's output stage does the resampling and
 * scheduled times map exactly to samples the user has heard.
 */
export const createBrowserPcmAudio: PcmAudioFactory = ({
  sampleRate,
  signal,
  onAudio,
  onPlaybackIdle,
  onError,
}): PcmAudio => {
  const lifetime = new AbortController();
  let closed = false;
  let muted = false;
  let starting: Promise<void> | null = null;
  let microphone: MediaStream | null = null;
  let captureContext: AudioContext | null = null;
  let captureSource: MediaStreamAudioSourceNode | null = null;
  let capture: AudioWorkletNode | null = null;
  let playbackContext: AudioContext | null = null;
  let segments: PlaybackSegment[] = [];
  let nextStart = 0;
  let scheduledItem: { readonly itemId: string; scheduledMs: number } | null = null;
  const playbackLevels = createPcmPlaybackLevels();
  let microphoneLevel = { level: 0, at: 0 };
  let detachLevels = () => {};

  const onContextStateChange = (event: Event) => {
    if ((event.target as AudioContext).state === "closed") fail("Voice audio stopped.");
  };
  const onTrackEnded = () => fail("Microphone access ended.");

  const createContext = (options?: AudioContextOptions) => {
    if (typeof AudioContext === "undefined") return null;
    const context = new AudioContext({ latencyHint: "interactive", ...options });
    context.addEventListener("statechange", onContextStateChange);
    return context;
  };

  const ensurePlayback = () => {
    playbackContext ??= createContext({ sampleRate });
    return playbackContext;
  };

  const stopPlayback = () => {
    for (const segment of segments) {
      segment.source.onended = null;
      segment.source.stop();
      segment.source.disconnect();
    }
    segments = [];
    nextStart = 0;
    scheduledItem = null;
    playbackLevels.clear();
  };

  const releaseContext = (context: AudioContext | null) => {
    if (context === null) return;
    context.removeEventListener("statechange", onContextStateChange);
    void context.close().catch(() => undefined);
  };

  function close() {
    if (closed) return;
    closed = true;
    lifetime.abort();
    signal.removeEventListener("abort", close);
    detachLevels();
    stopPlayback();
    for (const track of microphone?.getTracks() ?? []) {
      track.removeEventListener("ended", onTrackEnded);
      track.stop();
    }
    microphone = null;
    if (capture !== null) {
      capture.port.onmessage = null;
      capture.port.close();
      capture.onprocessorerror = null;
      capture.disconnect();
    }
    captureSource?.disconnect();
    capture = null;
    captureSource = null;
    releaseContext(captureContext);
    releaseContext(playbackContext);
    captureContext = null;
    playbackContext = null;
  }

  function fail(message: string) {
    if (closed) return;
    close();
    onError(message);
  }

  /** Rejects as soon as the call closes; a value that arrives later is handed to `release`. */
  const untilClosed = <A>(promise: Promise<A>, release?: (late: A) => void) =>
    new Promise<A>((resolve, reject) => {
      const cancelled = () => reject(new Error("The voice connection was cancelled."));
      if (lifetime.signal.aborted) cancelled();
      lifetime.signal.addEventListener("abort", cancelled, { once: true });
      promise.then(
        (value) => {
          lifetime.signal.removeEventListener("abort", cancelled);
          if (lifetime.signal.aborted) release?.(value);
          else resolve(value);
        },
        (error: unknown) => {
          lifetime.signal.removeEventListener("abort", cancelled);
          reject(error);
        },
      );
    });

  const startCapture = async () => {
    if (closed) throw new Error("The voice connection was cancelled.");
    if (!window.isSecureContext || navigator.mediaDevices?.getUserMedia === undefined)
      throw new Error("Calls need a secure (HTTPS) connection to use the microphone.");
    const playback = ensurePlayback();
    captureContext = createContext();
    if (playback === null || captureContext === null || captureContext.audioWorklet === undefined)
      throw new Error("This browser can't play call audio.");
    const context = captureContext;
    const stream = await untilClosed(
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
          video: false,
        })
        .catch((error: unknown) => {
          throw microphoneError(error);
        }),
      (late) => {
        for (const track of late.getTracks()) track.stop();
      },
    );
    microphone = stream;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !muted;
      track.addEventListener("ended", onTrackEnded);
    }
    const moduleUrl = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }),
    );
    try {
      await untilClosed(
        context.audioWorklet.addModule(moduleUrl).catch(() => {
          throw new Error("The microphone could not start.");
        }),
      );
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    captureSource = context.createMediaStreamSource(stream);
    capture = new AudioWorkletNode(context, CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      // Silent, but connected to the destination so every engine keeps pulling the node.
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: {
        outputRate: sampleRate,
        chunkFrames: Math.round((sampleRate * CAPTURE_CHUNK_MS) / 1000),
      },
    });
    capture.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!closed && !muted && event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        microphoneLevel = { level: pcm16Level(bytes), at: performance.now() };
        onAudio(bytesToBase64(bytes));
      }
    };
    capture.onprocessorerror = () => fail("Microphone audio stopped.");
    captureSource.connect(capture);
    capture.connect(context.destination);
    await untilClosed(
      Promise.all([context.resume(), playback.resume()]).catch(() => {
        throw new Error("Call audio could not start.");
      }),
    );
    detachLevels = callAudioLevels.attach(() => {
      const now = performance.now();
      return {
        microphone:
          muted || now - microphoneLevel.at > MICROPHONE_LEVEL_STALE_MS ? 0 : microphoneLevel.level,
        speaker:
          playbackContext === null ? 0 : playbackLevels.levelAt(playbackContext.currentTime * 1000),
      };
    });
  };

  if (signal.aborted) close();
  else signal.addEventListener("abort", close, { once: true });

  return {
    start: () => {
      starting ??= startCapture().catch((error: unknown) => {
        close();
        throw error;
      });
      return starting;
    },
    enqueue: (base64, itemId) => {
      if (closed) return;
      const context = ensurePlayback();
      if (context === null) {
        fail("This browser can't play call audio.");
        return;
      }
      const samples = decodePcm16(base64);
      if (samples === null) {
        fail("The voice reply contained unreadable audio.");
        return;
      }
      if (samples.length === 0) return;
      const now = context.currentTime;
      const start = Math.max(nextStart, now + PLAYBACK_LEAD_SECONDS);
      if (start - now > MAX_QUEUED_PLAYBACK_SECONDS) {
        fail("The voice reply was too long to play.");
        return;
      }
      const audio = context.createBuffer(1, samples.length, sampleRate);
      audio.copyToChannel(samples, 0);
      if (scheduledItem?.itemId !== itemId) scheduledItem = { itemId, scheduledMs: 0 };
      const source = context.createBufferSource();
      source.buffer = audio;
      source.connect(context.destination);
      const segment: PlaybackSegment = {
        itemId,
        source,
        start,
        durationMs: (audio.length / sampleRate) * 1000,
        itemOffsetMs: scheduledItem.scheduledMs,
      };
      scheduledItem.scheduledMs += segment.durationMs;
      source.onended = () => {
        source.disconnect();
        segments = segments.filter((candidate) => candidate !== segment);
        if (segments.length === 0 && !closed) onPlaybackIdle();
      };
      segments.push(segment);
      playbackLevels.push(sampleLevel(samples), segment.durationMs, start * 1000);
      source.start(start);
      nextStart = start + audio.duration;
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    },
    clear: (): PcmPlaybackPosition | null => {
      const context = playbackContext;
      if (context === null || segments.length === 0) {
        stopPlayback();
        return null;
      }
      // The output timestamp trails currentTime by the hardware latency: it is what was heard.
      const output = context.getOutputTimestamp?.().contextTime;
      const heard = Math.min(
        context.currentTime,
        output !== undefined && output > 0
          ? output
          : context.currentTime - (context.outputLatency || context.baseLatency || 0),
      );
      let current = segments[0]!;
      for (const segment of segments) {
        if (segment.start > heard) break;
        current = segment;
      }
      const intoSegmentMs = Math.min(
        current.durationMs,
        Math.max(0, (heard - current.start) * 1000),
      );
      stopPlayback();
      return { itemId: current.itemId, playedMs: Math.round(current.itemOffsetMs + intoSegmentMs) };
    },
    setMuted: (value) => {
      muted = value;
      for (const track of microphone?.getAudioTracks() ?? []) track.enabled = !value;
    },
    close,
  };
};
