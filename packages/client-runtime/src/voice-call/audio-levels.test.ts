import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  CALL_WAVEFORM_IDLE,
  callWaveformScales,
  createCallAudioLevelMeter,
  createPcmPlaybackLevels,
  pcm16Base64Level,
  pcm16Level,
  SILENT_CALL_AUDIO,
  type CallAudioLevels,
} from "./audio-levels.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("samples only while audio is attached and someone is listening", () => {
  const meter = createCallAudioLevelMeter({ intervalMs: 10 });
  const source = vi.fn(() => ({ microphone: 0.2, speaker: 0 }));
  const listener = vi.fn();

  meter.attach(source);
  vi.advanceTimersByTime(50);
  expect(source).not.toHaveBeenCalled();

  const unsubscribe = meter.subscribe(listener);
  vi.advanceTimersByTime(30);
  expect(source).toHaveBeenCalledTimes(3);
  expect(listener).toHaveBeenLastCalledWith({ microphone: 0.2, speaker: 0 });

  unsubscribe();
  vi.advanceTimersByTime(50);
  expect(source).toHaveBeenCalledTimes(3);
});

it("never stacks async reads and drops a read that settles after its audio stopped", async () => {
  const meter = createCallAudioLevelMeter({ intervalMs: 10 });
  const reads: Array<(levels: CallAudioLevels) => void> = [];
  const source = vi.fn(
    () =>
      new Promise<CallAudioLevels>((resolve) => {
        reads.push(resolve);
      }),
  );
  const heard: CallAudioLevels[] = [];
  meter.subscribe((levels) => heard.push(levels));
  const detach = meter.attach(source);

  vi.advanceTimersByTime(50);
  expect(source).toHaveBeenCalledTimes(1);

  reads[0]!({ microphone: 0, speaker: 0.5 });
  await Promise.resolve();
  expect(heard).toEqual([{ microphone: 0, speaker: 0.5 }]);

  vi.advanceTimersByTime(10);
  expect(source).toHaveBeenCalledTimes(2);
  detach();
  expect(heard.at(-1)).toEqual(SILENT_CALL_AUDIO);
  reads[1]!({ microphone: 0.9, speaker: 0.9 });
  await Promise.resolve();
  expect(heard.at(-1)).toEqual(SILENT_CALL_AUDIO);
  vi.advanceTimersByTime(50);
  expect(source).toHaveBeenCalledTimes(2);
});

it("lets a newer call's audio survive the previous call's late detach", () => {
  const meter = createCallAudioLevelMeter({ intervalMs: 10 });
  const listener = vi.fn();
  meter.subscribe(listener);
  const detachFirst = meter.attach(() => ({ microphone: 0.1, speaker: 0 }));
  meter.attach(() => ({ microphone: 0.3, speaker: 0 }));
  detachFirst();
  vi.advanceTimersByTime(10);
  expect(listener).toHaveBeenLastCalledWith({ microphone: 0.3, speaker: 0 });
});

it("clamps unreadable levels instead of publishing them", () => {
  const meter = createCallAudioLevelMeter({ intervalMs: 10 });
  const listener = vi.fn();
  meter.subscribe(listener);
  meter.attach(() => ({ microphone: Number.NaN, speaker: 4 }));
  vi.advanceTimersByTime(10);
  expect(listener).toHaveBeenLastCalledWith({ microphone: 0, speaker: 1 });
});

it("rests the waveform at silence and follows the louder channel", () => {
  expect(callWaveformScales(SILENT_CALL_AUDIO)).toEqual([
    CALL_WAVEFORM_IDLE,
    CALL_WAVEFORM_IDLE,
    CALL_WAVEFORM_IDLE,
    CALL_WAVEFORM_IDLE,
  ]);
  const speaking = callWaveformScales({ microphone: 0, speaker: 0.25 });
  expect(callWaveformScales({ microphone: 0.25, speaker: 0.01 })).toEqual(speaking);
  expect(Math.max(...speaking)).toBeLessThanOrEqual(1);
  expect(Math.min(...speaking)).toBeGreaterThan(CALL_WAVEFORM_IDLE);
  expect(Math.max(...callWaveformScales({ microphone: 1, speaker: 1 }))).toBe(1);
});

it("measures PCM16 loudness", () => {
  const full = new Uint8Array([0xff, 0x7f, 0x00, 0x80]);
  expect(pcm16Level(full)).toBeCloseTo(1, 3);
  expect(pcm16Level(new Uint8Array(8))).toBe(0);
  expect(pcm16Level(new Uint8Array(1))).toBe(0);
  expect(pcm16Base64Level(btoa(String.fromCharCode(...full)))).toBeCloseTo(1, 3);
  expect(pcm16Base64Level("not base64!")).toBe(0);
});

it("reports reply loudness only while that chunk is due to play", () => {
  const playback = createPcmPlaybackLevels();
  playback.push(0.4, 100, 1_000);
  playback.push(0.8, 100, 1_010);
  expect(playback.levelAt(999)).toBe(0);
  expect(playback.levelAt(1_050)).toBe(0.4);
  expect(playback.levelAt(1_150)).toBe(0.8);
  expect(playback.levelAt(1_200)).toBe(0);
  playback.push(0.5, 100, 1_000);
  playback.clear();
  expect(playback.levelAt(1_050)).toBe(0);
});

it("measures a deferred reply level once, and only when its slice is sampled", () => {
  const playback = createPcmPlaybackLevels();
  const measureFirst = vi.fn(() => 0.3);
  const measureSkipped = vi.fn(() => 0.6);
  playback.push(measureFirst, 100, 0);
  playback.push(measureSkipped, 100, 0);
  expect(playback.levelAt(10)).toBe(0.3);
  expect(playback.levelAt(20)).toBe(0.3);
  expect(measureFirst).toHaveBeenCalledTimes(1);
  expect(playback.levelAt(250)).toBe(0);
  expect(measureSkipped).not.toHaveBeenCalled();
});
