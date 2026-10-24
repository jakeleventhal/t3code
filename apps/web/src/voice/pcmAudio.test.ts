import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createBrowserPcmAudio } from "./pcmAudio";

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

interface FakeProcessor {
  readonly process: (inputs: Float32Array[][]) => boolean;
}

class FakeTrack extends EventTarget {
  enabled = true;
  stop = vi.fn();
}

class FakeSource {
  buffer: { length: number; duration: number } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  start = vi.fn((when: number) => {
    this.startedAt = when;
  });
  stop = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
}

function fixture(captureRate = 48_000) {
  const contexts: FakeContext[] = [];
  const sources: FakeSource[] = [];
  const nodes: FakeNode[] = [];
  const blobs = new Map<string, Blob>();
  let blobCount = 0;
  let constructingPort: FakeNode["port"] | null = null;

  class FakeContext extends EventTarget {
    readonly sampleRate: number;
    state = "suspended";
    currentTime = 0;
    outputTime = 0;
    readonly destination = {};
    readonly processors = new Map<string, new (options: unknown) => FakeProcessor>();
    readonly audioWorklet = {
      addModule: vi.fn(async (url: string) => {
        const source = await blobs.get(url)!.text();
        const scope = this;
        class AudioWorkletProcessor {
          readonly port = constructingPort!;
        }
        new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
          AudioWorkletProcessor,
          (name: string, processor: new (options: unknown) => FakeProcessor) =>
            scope.processors.set(name, processor),
          scope.sampleRate,
        );
      }),
    };
    constructor(options: { sampleRate?: number }) {
      super();
      this.sampleRate = options.sampleRate ?? captureRate;
      contexts.push(this);
    }
    resume = vi.fn(async () => {
      this.state = "running";
    });
    close = vi.fn(async () => {
      this.state = "closed";
      this.dispatchEvent(new Event("statechange"));
    });
    getOutputTimestamp() {
      return { contextTime: this.outputTime };
    }
    createBuffer(_channels: number, length: number, rate: number) {
      const data = new Float32Array(length);
      return {
        length,
        duration: length / rate,
        data,
        copyToChannel: (samples: Float32Array) => data.set(samples),
      };
    }
    createBufferSource() {
      const source = new FakeSource();
      sources.push(source);
      return source;
    }
    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
  }

  class FakeNode {
    readonly port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (data: unknown) => this.port.onmessage?.({ data }),
      close: vi.fn(),
    };
    readonly processor: FakeProcessor;
    onprocessorerror: (() => void) | null = null;
    connect = vi.fn();
    disconnect = vi.fn();
    constructor(context: FakeContext, name: string, options: unknown) {
      constructingPort = this.port;
      this.processor = new (context.processors.get(name)!)(options);
      nodes.push(this);
    }
  }

  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:test/${++blobCount}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    blobs.delete(url);
  });

  const abort = new AbortController();
  const chunks: string[] = [];
  const onPlaybackIdle = vi.fn();
  const onError = vi.fn();
  const audio = createBrowserPcmAudio({
    sampleRate: 24_000,
    signal: abort.signal,
    onAudio: (chunk) => chunks.push(chunk),
    onPlaybackIdle,
    onError,
  });
  const playback = () => contexts.find((context) => context.sampleRate === 24_000)!;
  const capture = () => nodes[0]!;
  return {
    audio,
    abort,
    chunks,
    contexts,
    sources,
    track,
    stream,
    getUserMedia,
    blobs,
    onPlaybackIdle,
    onError,
    playback,
    capture,
  };
}

function pcm16(samples: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(samples * 2)));
}

function decode(chunks: readonly string[]): Int16Array {
  const parts = chunks.map((chunk) => Uint8Array.from(atob(chunk), (char) => char.charCodeAt(0)));
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  const view = new DataView(joined.buffer);
  return Int16Array.from({ length: joined.length / 2 }, (_, index) =>
    view.getInt16(index * 2, true),
  );
}

/** Amplitude of `frequency` in `samples`, by quadrature correlation. */
function toneAmplitude(samples: Float32Array, rate: number, frequency: number): number {
  let sine = 0;
  let cosine = 0;
  for (let index = 0; index < samples.length; index++) {
    const phase = (2 * Math.PI * frequency * index) / rate;
    sine += samples[index]! * Math.sin(phase);
    cosine += samples[index]! * Math.cos(phase);
  }
  return (2 * Math.hypot(sine, cosine)) / samples.length;
}

function feedTone(processor: FakeProcessor, rate: number, frequency: number, seconds: number) {
  const total = Math.round(rate * seconds);
  for (let offset = 0; offset < total; offset += 128) {
    const block = Float32Array.from(
      { length: 128 },
      (_, index) => 0.5 * Math.sin((2 * Math.PI * frequency * (offset + index)) / rate),
    );
    processor.process([[block]]);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser PCM audio", () => {
  it.each([48_000, 44_100])(
    "streams %d Hz microphone audio as 24 kHz PCM16 with aliasing filtered out",
    async (deviceRate) => {
      const f = fixture(deviceRate);
      await f.audio.start();
      expect(f.getUserMedia).toHaveBeenCalledExactlyOnceWith({
        audio: expect.objectContaining({ echoCancellation: true }),
        video: false,
      });
      // The worklet loads from a Blob URL that is released once the module is in.
      expect(f.blobs.size).toBe(0);

      feedTone(f.capture().processor, deviceRate, 1_000, 1);
      const voice = Float32Array.from(decode(f.chunks), (sample) => sample / 0x8000);
      expect(voice.length).toBeGreaterThan(23_000);
      expect(voice.length).toBeLessThanOrEqual(24_000);
      expect(toneAmplitude(voice.subarray(1_000), 24_000, 1_000)).toBeCloseTo(0.5, 1);

      f.chunks.length = 0;
      // Above the 12 kHz output Nyquist: naive decimation would fold this into audible noise.
      feedTone(f.capture().processor, deviceRate, 19_000, 1);
      // Skip the switch between tones; only the steady state shows the filter.
      const folded = Float32Array.from(decode(f.chunks), (sample) => sample / 0x8000).subarray(
        1_000,
      );
      const rms = Math.sqrt(
        folded.reduce((sum, sample) => sum + sample * sample, 0) / folded.length,
      );
      expect(rms).toBeLessThan(0.01);
      f.audio.close();
    },
  );

  it("reports how much of the interrupted reply was actually heard", async () => {
    const f = fixture();
    await f.audio.start();
    // Three 100 ms chunks of one reply, then the next reply.
    for (let index = 0; index < 3; index++) f.audio.enqueue(pcm16(2_400), "item-a");
    f.audio.enqueue(pcm16(2_400), "item-b");
    expect(f.sources.map((source) => source.startedAt)).toEqual([
      expect.closeTo(0.05),
      expect.closeTo(0.15),
      expect.closeTo(0.25),
      expect.closeTo(0.35),
    ]);

    const context = f.playback();
    context.currentTime = 0.3;
    // The hardware is 20 ms behind the render clock.
    context.outputTime = 0.28;
    expect(f.audio.clear()).toEqual({ itemId: "item-a", playedMs: 230 });
    for (const source of f.sources) expect(source.stop).toHaveBeenCalledOnce();
    expect(f.audio.clear()).toBeNull();
    expect(f.onPlaybackIdle).not.toHaveBeenCalled();

    // After an interruption, new audio starts fresh rather than behind the cleared queue.
    f.audio.enqueue(pcm16(2_400), "item-c");
    f.audio.enqueue(pcm16(2_400), "item-c");
    expect(f.sources.at(-2)!.startedAt).toBeCloseTo(0.35);
    context.currentTime = 0.5;
    context.outputTime = 0.5;
    expect(f.audio.clear()).toEqual({ itemId: "item-c", playedMs: 150 });
    f.audio.close();
  });

  it("goes idle only after every queued chunk has played", async () => {
    const f = fixture();
    await f.audio.start();
    f.audio.enqueue(pcm16(2_400), "item-a");
    f.audio.enqueue(pcm16(2_400), "item-a");
    f.sources[0]!.onended?.();
    expect(f.onPlaybackIdle).not.toHaveBeenCalled();
    f.sources[1]!.onended?.();
    expect(f.onPlaybackIdle).toHaveBeenCalledOnce();
    expect(f.audio.clear()).toBeNull();
    f.audio.close();
  });

  it("ends at the permission prompt and stops a late grant", async () => {
    const f = fixture();
    const permission = deferred<typeof f.stream>();
    const stopped = deferred<void>();
    f.getUserMedia.mockImplementation(() => permission.promise);
    f.track.stop.mockImplementation(() => stopped.resolve());
    const started = f.audio.start();
    f.abort.abort();
    await expect(started).rejects.toThrow("cancelled");
    expect(f.contexts.every((context) => context.close.mock.calls.length === 1)).toBe(true);
    permission.resolve(f.stream);
    await stopped.promise;
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.contexts.some((context) => context.audioWorklet.addModule.mock.calls.length > 0)).toBe(
      false,
    );
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("explains a blocked microphone without holding any audio resources", async () => {
    const f = fixture();
    f.getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await expect(f.audio.start()).rejects.toThrow("Microphone access was blocked");
    expect(f.contexts.every((context) => context.state === "closed")).toBe(true);
  });

  it("stop releases the microphone, both contexts, and queued audio", async () => {
    const f = fixture();
    await f.audio.start();
    f.audio.enqueue(pcm16(2_400), "item-a");
    const node = f.capture();
    f.audio.close();
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalled();
    expect(f.contexts).toHaveLength(2);
    for (const context of f.contexts) expect(context.close).toHaveBeenCalledOnce();
    // Late worklet output and late reply audio are dropped, and closing is not a failure.
    node.port.postMessage(new ArrayBuffer(4));
    f.audio.enqueue(pcm16(2_400), "item-b");
    expect(f.chunks).toEqual([]);
    expect(f.sources).toHaveLength(1);
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("drops microphone audio while muted", async () => {
    const f = fixture();
    await f.audio.start();
    f.audio.setMuted(true);
    expect(f.track.enabled).toBe(false);
    f.capture().port.postMessage(new ArrayBuffer(4));
    expect(f.chunks).toEqual([]);
    f.audio.setMuted(false);
    expect(f.track.enabled).toBe(true);
    f.capture().port.postMessage(new ArrayBuffer(4));
    expect(f.chunks).toEqual(["AAAAAA=="]);
    f.audio.close();
  });

  it("fails the call instead of buffering an unbounded reply", async () => {
    const f = fixture();
    await f.audio.start();
    const oneSecond = pcm16(24_000);
    for (let second = 0; second < 181; second++) f.audio.enqueue(oneSecond, "item-a");
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("The voice reply was too long to play.");
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
  });

  it("fails safely on malformed reply audio and when the microphone is taken away", async () => {
    const malformed = fixture();
    await malformed.audio.start();
    // Three bytes cannot be whole PCM16 samples.
    malformed.audio.enqueue("AAAA", "item-a");
    expect(malformed.onError).toHaveBeenCalledExactlyOnceWith(
      "The voice reply contained unreadable audio.",
    );

    const revoked = fixture();
    await revoked.audio.start();
    revoked.track.dispatchEvent(new Event("ended"));
    expect(revoked.onError).toHaveBeenCalledExactlyOnceWith("Microphone access ended.");
    expect(revoked.contexts.every((context) => context.state === "closed")).toBe(true);
  });
});
