import { beforeEach, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  let pendingStart: { resolve: () => void; reject: (error: Error) => void } | null = null;
  const ids: string[] = [];
  return {
    listeners,
    ids,
    nextId: () => {
      ids.push(`session-${ids.length + 1}`);
      return ids.at(-1);
    },
    settleStart: () => pendingStart,
    module: {
      begin: vi.fn(),
      start: vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            pendingStart = { resolve, reject };
          }),
      ),
      enqueue: vi.fn(),
      clear: vi.fn(),
      setMuted: vi.fn(),
      stop: vi.fn(),
      addListener: vi.fn((name: string, listener: (event: Record<string, unknown>) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
        return { remove: () => set.delete(listener) };
      }),
    },
  };
});
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native.module }));
vi.mock("../lib/uuid", () => ({ uuidv4: native.nextId }));

import { createNativePcmAudio } from "./pcmAudio";

function emit(name: string, event: Record<string, unknown>) {
  for (const listener of native.listeners.get(name) ?? []) listener(event);
}

function open(signal = new AbortController().signal) {
  const callbacks = { onAudio: vi.fn(), onPlaybackIdle: vi.fn(), onError: vi.fn() };
  const audio = createNativePcmAudio({ sampleRate: 24_000, signal, ...callbacks });
  return { audio, callbacks, sessionId: native.ids.at(-1) };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
});

async function started(signal?: AbortSignal) {
  const opened = open(signal);
  const starting = opened.audio.start();
  native.settleStart()?.resolve();
  await starting;
  return opened;
}

it("reserves the session before the native start so an early close cancels it", async () => {
  const { audio, sessionId } = open();
  const starting = audio.start();
  expect(native.module.begin).toHaveBeenCalledWith(sessionId);
  audio.close();
  expect(native.module.stop).toHaveBeenCalledWith(sessionId);
  // Even if the native side had already opened, the late result cannot revive the call.
  native.settleStart()?.resolve();
  await expect(starting).rejects.toThrow("cancelled");
});

it("cancels through the call's signal, including one already aborted", async () => {
  const abort = new AbortController();
  const { audio, sessionId } = open(abort.signal);
  const starting = audio.start();
  abort.abort();
  native.settleStart()?.reject(new Error("The voice audio was cancelled."));
  await expect(starting).rejects.toThrow("cancelled");
  expect(native.module.stop).toHaveBeenCalledWith(sessionId);

  const aborted = new AbortController();
  aborted.abort();
  await expect(open(aborted.signal).audio.start()).rejects.toThrow("cancelled");
});

it("reports a native setup failure once, as the start rejection", async () => {
  const { audio, callbacks, sessionId } = open();
  const starting = audio.start();
  emit("onError", { sessionId, message: "Another voice call took over the microphone." });
  native.settleStart()?.reject(new Error("The voice audio was cancelled."));
  await expect(starting).rejects.toThrow("Another voice call took over the microphone.");
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it("only delivers events for its own session", async () => {
  const { callbacks, sessionId } = await started();
  emit("onAudio", { sessionId: "other", data: "AAAA" });
  emit("onPlaybackIdle", { sessionId: "other" });
  emit("onError", { sessionId: "other", message: "nope" });
  expect(callbacks.onAudio).not.toHaveBeenCalled();
  expect(callbacks.onPlaybackIdle).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();

  emit("onAudio", { sessionId, data: "AAAA" });
  emit("onPlaybackIdle", { sessionId });
  expect(callbacks.onAudio).toHaveBeenCalledWith("AAAA");
  expect(callbacks.onPlaybackIdle).toHaveBeenCalledOnce();
});

it("applies a mute chosen while starting once audio is open", async () => {
  const { audio, sessionId } = open();
  const starting = audio.start();
  audio.setMuted(true);
  expect(native.module.setMuted).not.toHaveBeenCalled();
  native.settleStart()?.resolve();
  await starting;
  expect(native.module.setMuted).toHaveBeenCalledWith(sessionId, true);
});

it("fails visibly on invalid reply audio and releases the session", async () => {
  const { audio, callbacks, sessionId } = await started();
  native.module.enqueue.mockImplementationOnce(() => {
    throw new Error("The voice reply contained invalid audio.");
  });
  audio.enqueue("not audio", "item-1");
  expect(callbacks.onError).toHaveBeenCalledWith("The voice reply contained invalid audio.");
  expect(native.module.stop).toHaveBeenCalledWith(sessionId);
  // Closed audio ignores everything after, including a repeated close.
  audio.enqueue("AAAA", "item-1");
  audio.close();
  expect(native.module.enqueue).toHaveBeenCalledOnce();
  expect(native.module.stop).toHaveBeenCalledOnce();
  expect(audio.clear()).toBeNull();
});

it("never reports more of an interrupted item than was heard", async () => {
  const { audio } = await started();
  native.module.clear.mockReturnValueOnce({ itemId: "item-1", playedMs: 1234.9 });
  expect(audio.clear()).toEqual({ itemId: "item-1", playedMs: 1234 });
  native.module.clear.mockReturnValueOnce(null);
  expect(audio.clear()).toBeNull();
});

it("ends on a native interruption and stops listening", async () => {
  const { callbacks, sessionId } = await started();
  emit("onError", { sessionId, message: "A call or another app interrupted the voice audio." });
  emit("onAudio", { sessionId, data: "AAAA" });
  expect(callbacks.onError).toHaveBeenCalledOnce();
  expect(callbacks.onAudio).not.toHaveBeenCalled();
  expect(native.listeners.get("onAudio")?.size).toBe(0);
});
