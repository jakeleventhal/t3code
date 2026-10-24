import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  VoiceCallConnection,
  VoiceCallConnector,
  VoiceCallTranscriptEntry,
} from "./controller.ts";
import { VoiceCallController } from "./controller.ts";
import { persistVoiceCalls, type VoiceCallWriter } from "./persistence.ts";

const target = {
  environmentId: EnvironmentId.make("env-a"),
  bot: { id: "assistant", title: "Assistant", botRole: "assistant" as const },
  threadRef: { environmentId: EnvironmentId.make("env-a"), threadId: ThreadId.make("thread-a") },
};
const entry = (ordinal = 0, revision = 0): VoiceCallTranscriptEntry => ({
  id: `entry-${ordinal}`,
  ordinal,
  revision,
  final: false,
  speaker: "user",
  text: `Words ${ordinal}/${revision}`,
});

function harness() {
  let live!: Parameters<VoiceCallConnector["connect"]>[0];
  const writer = {
    append: vi.fn<VoiceCallWriter["append"]>(async () => undefined),
    end: vi.fn<VoiceCallWriter["end"]>(async () => undefined),
  };
  const connection = {
    close: vi.fn<VoiceCallConnection["close"]>(async () => undefined),
    setMuted: vi.fn<VoiceCallConnection["setMuted"]>(async () => undefined),
    sendText: vi.fn(async (_text: string) => undefined),
  };
  const begin = vi.fn(async () => writer);
  const media = vi.fn<VoiceCallConnector["connect"]>(async (input) => {
    live = input;
    return connection;
  });
  const connector = persistVoiceCalls({ begin, media: { connect: media } });
  const signal = new AbortController();
  const onEvent = vi.fn();
  return {
    writer,
    connection,
    begin,
    media,
    connector,
    signal,
    onEvent,
    get live() {
      return live;
    },
    transcript: (value: VoiceCallTranscriptEntry) =>
      live.onEvent({ type: "transcript", entry: value }),
    start: () => connector.connect({ callId: "call-a", target, signal: signal.signal, onEvent }),
  };
}

afterEach(() => vi.useRealTimers());

describe("persisted voice connections", () => {
  it("does not acquire media before the call record commits or after a refused begin", async () => {
    const h = harness();
    const committed = Promise.withResolvers<typeof h.writer>();
    h.begin.mockReturnValueOnce(committed.promise);
    const opening = h.start();
    expect(h.media).not.toHaveBeenCalled();
    committed.resolve(h.writer);
    await opening;
    expect(h.media).toHaveBeenCalledOnce();
    const refused = harness();
    refused.begin.mockRejectedValueOnce(new Error("permission refused"));
    await expect(refused.start()).rejects.toThrow("permission refused");
    expect(refused.media).not.toHaveBeenCalled();
  });

  it("ends a committed record without opening media when cancelled during begin", async () => {
    const h = harness();
    const committed = Promise.withResolvers<typeof h.writer>();
    h.begin.mockReturnValueOnce(committed.promise);
    const opening = h.start();
    const rejected = expect(opening).rejects.toBe("user");
    h.signal.abort("user");
    committed.resolve(h.writer);
    await rejected;
    expect(h.media).not.toHaveBeenCalled();
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith("user", []);
  });

  it("coalesces revisions into bounded writes without idle polling or transcript replays", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connected = await h.start();
    for (let i = 0; i < 70; i++) h.transcript(entry(i));
    h.transcript({ ...entry(0, 1), final: true });
    h.transcript(entry(0));
    h.transcript(entry(0, 2));
    expect(h.writer.append).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.writer.append.mock.calls.map(([rows]) => rows.length)).toEqual([32, 32, 6]);
    const saved = h.writer.append.mock.calls.flatMap(([rows]) => rows);
    expect(saved).toHaveLength(70);
    expect(saved[0]).toEqual({ ...entry(0, 1), final: true });
    h.transcript(entry(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.writer.append).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    await connected.close("user");
  });

  it("does not lose a correction received while the earlier revision is saving", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connected = await h.start();
    const acknowledged = Promise.withResolvers<void>();
    const writing = Promise.withResolvers<void>();
    h.writer.append.mockImplementationOnce(() => {
      writing.resolve();
      return acknowledged.promise;
    });
    h.transcript(entry());
    vi.advanceTimersByTime(200);
    await writing.promise;
    h.transcript({ ...entry(0, 1), final: true });
    const ending = connected.close("user");
    expect(h.live.signal.aborted).toBe(true);
    expect(h.writer.end).not.toHaveBeenCalled();
    acknowledged.resolve();
    await ending;
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith("user", [{ ...entry(0, 1), final: true }]);
    expect(h.writer.append).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops audio immediately but drains late finals before atomically ending the card", async () => {
    const h = harness();
    const connected = await h.start();
    const drained = Promise.withResolvers<void>();
    const closing = Promise.withResolvers<void>();
    h.connection.close.mockImplementationOnce(() => {
      closing.resolve();
      return drained.promise;
    });
    h.transcript(entry());
    const ending = connected.close("user");
    expect(h.live.signal.aborted).toBe(true);
    await closing.promise;
    h.transcript({ ...entry(0, 1), final: true });
    expect(h.writer.end).not.toHaveBeenCalled();
    drained.resolve();
    await ending;
    await connected.close("replaced");
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith("user", [{ ...entry(0, 1), final: true }]);
    expect(h.connection.close).toHaveBeenCalledOnce();
  });

  it("splits the final drain at the wire limit and commits the last batch with end", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connected = await h.start();
    for (let i = 0; i < 70; i++) h.transcript(entry(i));
    await connected.close("user");
    expect(h.writer.append.mock.calls.map(([rows]) => rows.length)).toEqual([32, 32]);
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith(
      "user",
      Array.from({ length: 6 }, (_, i) => entry(i + 64)),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops capture and reports save failure, retaining unacknowledged rows for finalization", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connected = await h.start();
    h.writer.append.mockRejectedValueOnce(new Error("private storage details"));
    h.transcript(entry());
    await vi.advanceTimersByTimeAsync(200);
    expect(h.live.signal.aborted).toBe(true);
    expect(h.onEvent).toHaveBeenCalledWith({
      type: "failed",
      message: "Audio stopped because the conversation could not be saved.",
    });
    await connected.close("error");
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith("error", [entry()]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.writer.append).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drains every remaining page after another device has already ended the old call", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connected = await h.start();
    h.writer.append.mockRejectedValue(new Error("Call already replaced"));
    for (let i = 0; i < 70; i++) h.transcript(entry(i));
    await connected.close("replaced");
    expect(h.writer.append).not.toHaveBeenCalled();
    expect(h.writer.end.mock.calls.map(([reason, rows]) => [reason, rows.length])).toEqual([
      ["replaced", 32],
      ["replaced", 32],
      ["replaced", 6],
    ]);
    expect(h.writer.end.mock.calls.flatMap(([, rows]) => rows)).toEqual(
      Array.from({ length: 70 }, (_, i) => entry(i)),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a failed final save observable without restarting media", async () => {
    const h = harness();
    const connected = await h.start();
    h.writer.end.mockRejectedValueOnce(new Error("offline"));
    await expect(connected.close("user")).rejects.toThrow("offline");
    expect(h.live.signal.aborted).toBe(true);
    expect(h.media).toHaveBeenCalledOnce();
  });

  it("preserves user cancellation during media setup and closes the record once", async () => {
    const h = harness();
    const entered = Promise.withResolvers<void>();
    h.media.mockImplementationOnce((input) => {
      entered.resolve();
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener(
          "abort",
          () => {
            input.onEvent({ type: "failed", message: "The connection was cancelled." });
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      });
    });
    const opening = h.start();
    const rejected = expect(opening).rejects.toThrow("cancelled");
    await entered.promise;
    h.signal.abort("user");
    await rejected;
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith("user", []);
  });

  it("persists a failed media setup and keeps the chosen adapter's typed-message support", async () => {
    const failed = harness();
    failed.media.mockRejectedValueOnce(new Error("provider refused"));
    await expect(failed.start()).rejects.toThrow();
    expect(failed.writer.end).toHaveBeenCalledExactlyOnceWith("error", []);
    const h = harness();
    const connected = await h.start();
    await connected.sendText?.("Actually the sign-in button");
    expect(h.connection.sendText).toHaveBeenCalledExactlyOnceWith("Actually the sign-in button");
    await connected.close("user");
  });

  it("keeps a replacement call out of the old call's late transcript drain", async () => {
    const h = harness();
    let id = 0;
    const controller = new VoiceCallController(h.connector, () => `call-${++id}`);
    expect(await controller.start(target)).toEqual({ ok: true });
    const oldMedia = h.live;
    h.connection.close.mockImplementationOnce(async () => {
      oldMedia.onEvent({ type: "transcript", entry: { ...entry(), final: true } });
    });
    expect(await controller.start(target, { replacingCallId: "call-1" })).toEqual({ ok: true });
    expect(h.writer.end).toHaveBeenCalledExactlyOnceWith("replaced", [{ ...entry(), final: true }]);
    expect(controller.getTranscript("call-2")).toEqual([]);
    expect(oldMedia.signal.reason).toBe("replaced");
    await controller.end("call-2");
  });
});
