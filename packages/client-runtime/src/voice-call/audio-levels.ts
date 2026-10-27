// @effect-diagnostics globalTimers:off - Level sampling is a UI cadence owned by the visible call bar, outside any Effect runtime.

/** Linear amplitudes, 0..1, of what the call is actually capturing and playing. */
export interface CallAudioLevels {
  /** The caller's microphone as sent; zero while muted. */
  readonly microphone: number;
  /** The bot's reply as played; zero while playback is held back. */
  readonly speaker: number;
}

export const SILENT_CALL_AUDIO: CallAudioLevels = { microphone: 0, speaker: 0 };

/**
 * Reads the live call's loudness. Null means nothing measurable right now. Async sources, such as
 * WebRTC stats, are never called again until the previous read settles.
 */
export type CallAudioLevelSource = () =>
  | CallAudioLevels
  | null
  | PromiseLike<CallAudioLevels | null>;

const SAMPLE_INTERVAL_MS = 80;

export interface CallAudioLevelMeter {
  /** Call media registers while its audio runs. Detaching only removes that same source. */
  readonly attach: (source: CallAudioLevelSource) => () => void;
  /** Samples run only while a listener exists and audio is attached; nothing polls otherwise. */
  readonly subscribe: (listener: (levels: CallAudioLevels) => void) => () => void;
}

const clampLevel = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function createCallAudioLevelMeter(options?: {
  readonly intervalMs?: number;
}): CallAudioLevelMeter {
  const intervalMs = options?.intervalMs ?? SAMPLE_INTERVAL_MS;
  const listeners = new Set<(levels: CallAudioLevels) => void>();
  let source: CallAudioLevelSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pending = false;
  // A read that settles after its source was replaced or detached must not be published.
  let generation = 0;

  const emit = (levels: CallAudioLevels) => {
    const clamped = {
      microphone: clampLevel(levels.microphone),
      speaker: clampLevel(levels.speaker),
    };
    for (const listener of listeners) listener(clamped);
  };

  const sample = () => {
    if (source === null || pending) return;
    const read = generation;
    let result: ReturnType<CallAudioLevelSource>;
    try {
      result = source();
    } catch {
      return;
    }
    if (result === null || !("then" in result)) {
      if (result !== null) emit(result);
      return;
    }
    pending = true;
    result.then(
      (levels) => {
        pending = false;
        if (read === generation && levels !== null) emit(levels);
      },
      () => {
        pending = false;
      },
    );
  };

  const sync = () => {
    const wanted = source !== null && listeners.size > 0;
    if (wanted && timer === null) timer = setInterval(sample, intervalMs);
    if (!wanted && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    attach: (next) => {
      generation++;
      pending = false;
      source = next;
      sync();
      return () => {
        if (source !== next) return;
        generation++;
        pending = false;
        source = null;
        sync();
        emit(SILENT_CALL_AUDIO);
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      sync();
      return () => {
        listeners.delete(listener);
        sync();
      };
    },
  };
}

/**
 * A WebRTC stats report's loudest captured source and received audio. Browsers and native WebRTC
 * both report `audioLevel` as linear amplitude.
 */
export function rtcStatsAudioLevels(report: {
  readonly forEach: (
    callback: (stat: { readonly type?: unknown; readonly kind?: unknown }) => void,
  ) => void;
}): CallAudioLevels {
  let microphone = 0;
  let speaker = 0;
  report.forEach((stat) => {
    const level = (stat as { readonly audioLevel?: unknown }).audioLevel;
    if (typeof level !== "number" || stat.kind !== "audio") return;
    if (stat.type === "media-source") microphone = Math.max(microphone, level);
    else if (stat.type === "inbound-rtp") speaker = Math.max(speaker, level);
  });
  return { microphone, speaker };
}

// Per-bar gain, so one loudness reads as a small waveform rather than a single block.
export const CALL_WAVEFORM_GAINS = [0.55, 1, 0.75, 0.9] as const;
/** Bar height at silence, as a fraction of full. Enough to show the bars are there. */
export const CALL_WAVEFORM_IDLE = 0.2;

/**
 * Bar heights for the loudest live channel. Levels are linear amplitude and speech sits well
 * below 0.5, so a square root spreads it over the bar.
 */
export function callWaveformScales(levels: CallAudioLevels): number[] {
  const level = Math.max(clampLevel(levels.microphone), clampLevel(levels.speaker));
  return CALL_WAVEFORM_GAINS.map((gain) =>
    Math.max(CALL_WAVEFORM_IDLE, Math.min(1, Math.sqrt(level) * 1.6 * gain)),
  );
}

/** Root mean square of little-endian PCM16, as a 0..1 linear amplitude. */
export function pcm16Level(bytes: Uint8Array): number {
  const frames = Math.floor(bytes.length / 2);
  if (frames === 0) return 0;
  let sum = 0;
  for (let index = 0; index < frames; index++) {
    const raw = bytes[index * 2]! | (bytes[index * 2 + 1]! << 8);
    const sample = (raw >= 0x8000 ? raw - 0x10000 : raw) / 0x8000;
    sum += sample * sample;
  }
  return Math.sqrt(sum / frames);
}

/** `pcm16Level` for the base64 chunks both clients exchange with voice providers. */
export function pcm16Base64Level(base64: string): number {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return 0;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return pcm16Level(bytes);
}

/**
 * The loudness of PCM chunks along the schedule they play on. Replies arrive faster than real
 * time, so a chunk's level only counts while its own slice of the playback timeline is due. A
 * level may be a function, measured only if that slice is ever sampled.
 */
export function createPcmPlaybackLevels() {
  let slices: Array<{
    readonly start: number;
    readonly end: number;
    level: number | (() => number);
  }> = [];
  let nextStart = 0;
  return {
    push(level: number | (() => number), durationMs: number, nowMs: number) {
      const start = Math.max(nextStart, nowMs);
      nextStart = start + durationMs;
      slices.push({ start, end: nextStart, level });
    },
    levelAt(nowMs: number): number {
      slices = slices.filter((slice) => slice.end > nowMs);
      const current = slices[0];
      if (current === undefined || current.start > nowMs) return 0;
      if (typeof current.level === "function") current.level = current.level();
      return current.level;
    },
    clear() {
      slices = [];
      nextStart = 0;
    },
  };
}
