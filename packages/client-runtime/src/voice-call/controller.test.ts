import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  VoiceCallController,
  type VoiceCallConnection,
  type VoiceCallConnector,
  type VoiceCallEvent,
  type VoiceCallTarget,
  type VoiceCallTranscriptEntry,
} from "./controller.ts";

const target = (botId = "assistant", environment = "env-a"): VoiceCallTarget => ({
  environmentId: EnvironmentId.make(environment),
  bot: { id: botId, title: botId, botRole: botId === "assistant" ? "assistant" : "specialist" },
  threadRef: { environmentId: EnvironmentId.make(environment), threadId: ThreadId.make(botId) },
});

const entry = (overrides: Partial<VoiceCallTranscriptEntry> = {}): VoiceCallTranscriptEntry => ({
  id: "utterance-1",
  speaker: "user",
  text: "See that login button",
  final: false,
  revision: 1,
  ordinal: 0,
  ...overrides,
});

function harness() {
  let onNextConnect = () => {};
  const attempts: Array<{
    input: Parameters<VoiceCallConnector["connect"]>[0];
    connection: { -readonly [K in keyof VoiceCallConnection]: VoiceCallConnection[K] };
    ready: ReturnType<typeof Promise.withResolvers<VoiceCallConnection>>;
  }> = [];
  let id = 0;
  const controller = new VoiceCallController(
    {
      connect: (input) => {
        const ready = Promise.withResolvers<VoiceCallConnection>();
        const connection = {
          close: vi.fn(async () => undefined),
          setMuted: vi.fn(async () => undefined),
          sendText: vi.fn(async () => undefined),
        };
        attempts.push({ input, connection, ready });
        onNextConnect();
        onNextConnect = () => {};
        return ready.promise;
      },
    },
    () => `call-${++id}`,
  );
  const start = async (destination = target()) => {
    const promise = controller.start(destination);
    const attempt = attempts.at(-1)!;
    attempt.ready.resolve(attempt.connection);
    expect(await promise).toEqual({ ok: true });
    attempt.input.onEvent({ type: "phase", phase: "listening" });
    return attempt;
  };
  return {
    controller,
    attempts,
    start,
    onNextConnect: (listener: () => void) => {
      onNextConnect = listener;
    },
  };
}

describe("VoiceCallController", () => {
  it("waits for media readiness and rejects a second call without the observed replacement id", async () => {
    const { controller, attempts } = harness();
    const connecting = controller.start(target());
    expect(controller.getSnapshot()?.phase).toBe("connecting");
    expect((await controller.start(target("fitness"))).ok).toBe(false);
    attempts[0]!.ready.resolve(attempts[0]!.connection);
    await connecting;
    expect(controller.getSnapshot()?.phase).toBe("connecting");
    attempts[0]!.input.onEvent({ type: "phase", phase: "listening" });
    expect(controller.getSnapshot()?.phase).toBe("listening");
    expect((await controller.start(target("fitness"))).ok).toBe(false);
    expect((await controller.start(target("fitness"), { replacingCallId: "stale" })).ok).toBe(
      false,
    );
    expect(attempts).toHaveLength(1);
  });

  it("aborts capture immediately when ended during connection setup and closes a late connection once", async () => {
    const { controller, attempts } = harness();
    const pending = controller.start(target());
    const attempt = attempts[0]!;
    await controller.end("call-1");
    expect(attempt.input.signal.aborted).toBe(true);
    expect(controller.getSnapshot()).toBeNull();
    attempt.ready.resolve(attempt.connection);
    expect((await pending).ok).toBe(false);
    expect(attempt.connection.close).toHaveBeenCalledExactlyOnceWith("user");
    attempt.input.onEvent({ type: "phase", phase: "speaking" });
    expect(controller.getSnapshot()).toBeNull();
  });

  it("closes the old microphone before connecting the explicitly chosen new bot", async () => {
    const { controller, attempts, start, onNextConnect } = harness();
    const first = await start();
    const released = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const connecting = Promise.withResolvers<void>();
    onNextConnect(connecting.resolve);
    first.connection.close = vi.fn(() => {
      closed.resolve();
      return released.promise;
    });
    const next = controller.start(target("fitness"), { replacingCallId: "call-1" });
    await closed.promise;
    expect(first.input.signal.aborted).toBe(true);
    expect(attempts).toHaveLength(1);
    released.resolve();
    await connecting.promise;
    expect(attempts).toHaveLength(2);
    const second = attempts[1]!;
    second.ready.resolve(second.connection);
    expect(await next).toEqual({ ok: true });
    first.input.onEvent({ type: "phase", phase: "speaking" });
    first.input.onEvent({ type: "transcript", entry: entry() });
    await controller.end("call-1");
    expect(controller.getSnapshot()?.bot.id).toBe("fitness");
    expect(controller.getTranscript("call-2")).toEqual([]);
  });

  it("does not notify compact controls for transcript fragments or repeated phase events", async () => {
    const { controller, start } = harness();
    const call = await start();
    const controlsChanged = vi.fn();
    const wordsChanged = vi.fn();
    controller.subscribe(controlsChanged);
    controller.subscribeTranscript(wordsChanged);
    const before = controller.getSnapshot();
    call.input.onEvent({ type: "transcript", entry: entry() });
    call.input.onEvent({
      type: "transcript",
      entry: entry({ revision: 2, text: "See that login button?" }),
    });
    call.input.onEvent({ type: "phase", phase: "listening" });
    expect(controller.getSnapshot()).toBe(before);
    expect(controlsChanged).not.toHaveBeenCalled();
    expect(wordsChanged).toHaveBeenCalledTimes(2);
  });

  it("orders overlapping speakers and rejects replayed or regressive transcript revisions", async () => {
    const { controller, start } = harness();
    const call = await start();
    const send = (value: VoiceCallTranscriptEntry) =>
      call.input.onEvent({ type: "transcript", entry: value });
    send(entry({ id: "bot-1", ordinal: 1, speaker: "bot", text: "Yes." }));
    send(entry());
    send(entry({ revision: 3, final: true, text: "See that sign-in button?" }));
    send(entry({ revision: 2, text: "Stale correction" }));
    send(entry({ revision: 4, final: false, text: "Stale interim" }));
    send(entry({ revision: 5, final: true, speaker: "bot", text: "Wrong speaker" }));
    const words = controller.getTranscript("call-1");
    expect(words.map((word) => word.text)).toEqual(["See that sign-in button?", "Yes."]);
    expect(controller.getTranscript("call-1")).toBe(words);
    send(entry({ revision: 3, final: true, text: "Duplicate packet" }));
    expect(controller.getTranscript("call-1")).toBe(words);
  });

  it("keeps drafts across drawer subscriptions and protects new typing while a send finishes", async () => {
    const { controller, start } = harness();
    const call = await start();
    const sent = Promise.withResolvers<void>();
    call.connection.sendText = vi.fn(() => sent.promise);
    controller.setDraft("call-1", "First correction");
    const unsubscribe = controller.subscribeDraft(vi.fn());
    unsubscribe();
    expect(controller.getDraft("call-1").text).toBe("First correction");
    const sending = controller.sendDraft("call-1");
    expect((await controller.sendDraft("call-1")).ok).toBe(false);
    controller.setDraft("call-1", "Second correction");
    sent.resolve();
    expect(await sending).toEqual({ ok: true });
    expect(call.connection.sendText).toHaveBeenCalledExactlyOnceWith("First correction");
    expect(controller.getDraft("call-1")).toEqual({
      text: "Second correction",
      sending: false,
      error: null,
    });
  });

  it("retains failed typed input and never falls back to a normal harness turn", async () => {
    const { controller, start } = harness();
    const call = await start();
    call.connection.sendText = vi.fn(async () => {
      throw new Error("disconnected");
    });
    controller.setDraft("call-1", "Keep this correction");
    expect((await controller.sendDraft("call-1")).ok).toBe(false);
    expect(controller.getDraft("call-1")).toMatchObject({
      text: "Keep this correction",
      sending: false,
    });
    expect(controller.getDraft("call-1").error).toBeTruthy();
  });

  it("does not leak drafts across environments or conversations", async () => {
    const { controller, start } = harness();
    await start();
    controller.setDraft("call-1", "Private to this conversation");
    await controller.end("call-1");
    await start(target("assistant", "env-b"));
    expect(controller.getDraft("call-2").text).toBe("");
    await controller.end("call-2");
    await start();
    expect(controller.getDraft("call-3").text).toBe("Private to this conversation");
  });

  it("exposes text support only after connecting and clears it when the call fails", async () => {
    const { controller, attempts } = harness();
    const pending = controller.start(target());
    expect(controller.getSnapshot()?.canSendText).toBe(false);
    const call = attempts[0]!;
    call.ready.resolve(call.connection);
    await pending;
    expect(controller.getSnapshot()?.canSendText).toBe(true);
    call.input.onEvent({ type: "failed", message: "Connection lost" });
    expect(controller.getSnapshot()?.canSendText).toBe(false);
  });

  it("keeps an unsupported text error visible to the composer", async () => {
    const { controller, attempts } = harness();
    const pending = controller.start(target());
    const call = attempts[0]!;
    delete call.connection.sendText;
    call.ready.resolve(call.connection);
    await pending;
    expect(controller.getSnapshot()?.canSendText).toBe(false);
    controller.setDraft("call-1", "Keep this");
    expect((await controller.sendDraft("call-1")).ok).toBe(false);
    expect(controller.getDraft("call-1").error).toBeTruthy();
    expect(controller.getDraft("call-1").text).toBe("Keep this");
  });

  it("releases a retired call's pending send without letting its late completion clear a new draft", async () => {
    const { controller, start } = harness();
    const first = await start();
    const firstSent = Promise.withResolvers<void>();
    first.connection.sendText = () => firstSent.promise;
    controller.setDraft("call-1", "Old correction");
    const pending = controller.sendDraft("call-1");
    await controller.end("call-1");
    const second = await start();
    expect(controller.getDraft("call-2").sending).toBe(false);
    const secondSent = Promise.withResolvers<void>();
    second.connection.sendText = () => secondSent.promise;
    controller.setDraft("call-2", "New correction");
    const next = controller.sendDraft("call-2");
    firstSent.resolve();
    await pending;
    expect(controller.getDraft("call-2")).toMatchObject({ text: "New correction", sending: true });
    secondSent.resolve();
    expect(await next).toEqual({ ok: true });
    expect(controller.getDraft("call-2")).toEqual({ text: "", sending: false, error: null });
  });

  it("ignores stale mute completion after remote takeover", async () => {
    const { controller, start } = harness();
    const call = await start();
    const muted = Promise.withResolvers<void>();
    call.connection.setMuted = vi.fn(() => muted.promise);
    const pending = controller.toggleMute("call-1");
    expect(controller.getSnapshot()?.muted).toBe(false);
    call.input.onEvent({ type: "ended", reason: "interrupted" });
    expect(call.input.signal.aborted).toBe(true);
    muted.resolve();
    await pending;
    expect(controller.getSnapshot()).toBeNull();
  });

  it("retains a visible failure, releases media, and refuses late transport updates", async () => {
    const { controller, start } = harness();
    const call = await start();
    call.input.onEvent({ type: "failed", message: "Voice connection lost." });
    expect(call.input.signal.aborted).toBe(true);
    const failed = controller.getSnapshot();
    expect(failed).toMatchObject({ phase: "failed", error: "Voice connection lost." });
    const late: VoiceCallEvent[] = [
      { type: "phase", phase: "listening" },
      { type: "transcript", entry: entry() },
      { type: "ended", reason: "bot" },
    ];
    for (const event of late) call.input.onEvent(event);
    expect(controller.getSnapshot()).toBe(failed);
    expect(controller.getTranscript("call-1")).toEqual([]);
    await controller.end("call-1");
    expect(call.connection.close).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("rejects a conversation routed to another environment before capturing audio", async () => {
    const { controller, attempts } = harness();
    const destination = { ...target(), threadRef: target("assistant", "env-b").threadRef };
    expect((await controller.start(destination)).ok).toBe(false);
    expect(attempts).toHaveLength(0);
  });
});
