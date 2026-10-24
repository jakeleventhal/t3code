export interface PcmPlaybackPosition {
  readonly itemId: string;
  readonly playedMs: number;
}

/** Mono signed PCM16 little-endian, held in memory only. */
export interface PcmAudio {
  readonly start: () => Promise<void>;
  readonly enqueue: (base64: string, itemId: string) => void;
  readonly clear: () => PcmPlaybackPosition | null;
  readonly setMuted: (muted: boolean) => void;
  readonly close: () => void;
}

export type PcmAudioFactory = (input: {
  readonly sampleRate: number;
  readonly signal: AbortSignal;
  readonly onAudio: (base64: string) => void;
  readonly onPlaybackIdle: () => void;
  readonly onError: (message: string) => void;
}) => PcmAudio;
