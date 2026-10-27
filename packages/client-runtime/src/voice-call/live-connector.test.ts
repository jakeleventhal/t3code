import { EnvironmentId, MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { VoiceCallController, type VoiceCallEvent, type VoiceCallTarget } from "./controller.ts";
import {
  boundLiveContext,
  captureVoiceView,
  createLiveVoiceConnector,
  createVoiceViewContext,
  type LiveVoiceBackend,
  type VoiceWorkUpdate,
} from "./live-connector.ts";
import type { LiveMediaInput } from "./live-media.ts";
import { LiveSession } from "./live-session.ts";

const target: VoiceCallTarget = {
  environmentId: EnvironmentId.make("env"),
  bot: { id: "assistant", title: "Assistant", botRole: "assistant" },
  threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
};
function fixture(onContext?: (text: string) => void, protocol: "live" | "codex" = "live") {
  let session: LiveSession;
  let callbacks: LiveMediaInput["callbacks"];
  const sent: Array<{ type: string; event_id: string; content?: string; delegation_id?: string }> =
    [];
  const view = createVoiceViewContext();
  view.set("The user is viewing PR #42 on this device.");
  const detachWork = vi.fn();
  let updateWork: ((update: VoiceWorkUpdate) => void) | null = null;
  const work = {
    threadId: target.threadRef.threadId,
    runId: RunId.make("run"),
    messageId: MessageId.make("work"),
  };
  const backend = {
    watchContext: vi.fn<NonNullable<LiveVoiceBackend["watchContext"]>>(() => () => {}),
    captureView: vi.fn(async () => view.read()),
    negotiate: vi.fn(async () => ({ sessionId: "session", sdp: "answer" })),
    startWork: vi.fn<LiveVoiceBackend["startWork"]>(async () => work),
    watchWork: vi.fn(
      (_target: VoiceCallTarget, _work: typeof work, update: (update: VoiceWorkUpdate) => void) => {
        updateWork = update;
        return detachWork;
      },
    ),
  };
  const connector = createLiveVoiceConnector({
    view,
    backend,
    openMedia: async (input) => {
      callbacks = input.callbacks;
      let id = 0;
      session = new LiveSession({
        callbacks,
        createEventId: () => `command-${++id}`,
        send: (text) => {
          const packet = JSON.parse(text) as (typeof sent)[number];
          sent.push(packet);
          if (packet.content) onContext?.(packet.content);
          queueMicrotask(() =>
            session.receive(
              JSON.stringify(
                packet.type === "session.close"
                  ? { type: "session.closed", reason: "close_requested" }
                  : { type: `${packet.type}ed`, client_event_id: packet.event_id },
              ),
            ),
          );
        },
      });
      session.setProtocol(protocol);
      await input.negotiate("offer", input.signal);
      session.receive(JSON.stringify({ type: "session.started", session: { id: "session" } }));
      return {
        session,
        allowReply: vi.fn(),
        close: () => session.close(),
        setMuted: vi.fn(async () => undefined),
      };
    },
  });
  let calls = 0;
  const controller = new VoiceCallController(connector, () => `call-${++calls}`);
  const fragment = (id: string, text: string, startMs: number, speaker: "user" | "bot" = "user") =>
    callbacks.onTranscript({ id, text, startMs, endMs: startMs + 100, speaker });
  const delegate = (id = "request", offsetMs = 1000) =>
    session.receive(
      JSON.stringify({
        type: "session.delegation.created",
        offset_ms: offsetMs,
        delegation: { id, target: "client" },
      }),
    );
  return {
    controller,
    connector,
    backend,
    sent,
    view,
    fragment,
    delegate,
    nativeDelegate: (text: string) =>
      session.receive(
        JSON.stringify({
          type: "delegation.created",
          item: {
            id: "native-work",
            type: "delegation",
            target: "client",
            content: [{ type: "input_text", text }],
          },
        }),
      ),
    detachWork,
    update: (value: VoiceWorkUpdate) => updateWork!(value),
  };
}

// Flush only the promise chain for a synchronous test transport, never a timed wait.
async function settle() {
  for (let n = 0; n < 8; n++) await Promise.resolve();
}

describe("Live voice and selected harness", () => {
  it("keeps inherited work silent until the caller speaks in each new call", async () => {
    const f = fixture();
    for (const id of ["call-1", "call-2"]) {
      await f.controller.start(target);
      const update = f.backend.watchContext.mock.calls.at(-1)![1];
      update({ kind: "context", text: "Previous task finished", speak: true });
      await settle();
      expect(f.sent.at(-1)?.type).toBe("session.thinking.append");
      f.fragment(id, "What finished?", 100);
      update({ kind: "context", text: "Here is the result", speak: true });
      await settle();
      expect(f.sent.at(-1)?.type).toBe("session.commentary.append");
      await f.controller.end(id);
    }
  });

  it("reads page contents only for a request, not for navigation or connection", async () => {
    const f = fixture();
    await f.controller.start(target);
    f.view.set("The user is on the login page.");
    await settle();
    expect(f.backend.captureView).not.toHaveBeenCalled();
    f.backend.captureView.mockResolvedValue("button: Login");
    f.fragment("ask", "See that login button?", 100);
    f.delegate();
    await settle();
    expect(f.backend.captureView).toHaveBeenCalledOnce();
    expect(f.backend.startWork).toHaveBeenCalledWith(
      expect.objectContaining({ viewContext: "button: Login" }),
    );
    await f.controller.end("call-1");
  });

  it("does not start work if the call ends while the page is being read", async () => {
    const f = fixture();
    const page = Promise.withResolvers<string>();
    f.backend.captureView.mockReturnValue(page.promise);
    await f.controller.start(target);
    f.fragment("ask", "See that login button?", 100);
    f.delegate();
    await settle();
    await f.controller.end("call-1");
    page.resolve("button: Login");
    await settle();
    expect(f.backend.startWork).not.toHaveBeenCalled();
  });
  it("keeps listening while work runs, deduplicates requests, and returns the result to its delegation", async () => {
    const f = fixture();
    expect(await f.controller.start(target)).toEqual({ ok: true });
    f.fragment("first", "Review this PR", 100);
    f.fragment("second", " and take screenshots", 200);
    f.delegate();
    f.delegate();
    await settle();
    expect(f.backend.startWork).toHaveBeenCalledTimes(1);
    expect(f.backend.startWork.mock.calls[0]).toEqual([
      expect.objectContaining({
        target,
        requestId: "request",
        viewContext: "The user is viewing PR #42 on this device.",
        text: expect.stringContaining(" and take screenshots"),
      }),
    ]);
    expect(f.controller.getSnapshot()?.phase).toBe("listening");
    expect(f.controller.getTranscript("call-1")[0]?.text).toBe(
      "Review this PR and take screenshots",
    );
    f.update({ status: "completed", text: "The branch passed; screenshots are saved." });
    await settle();
    expect(f.sent).toContainEqual(
      expect.objectContaining({
        type: "session.commentary.append",
        delegation_id: "request",
        content: expect.stringContaining("screenshots are saved"),
      }),
    );
    expect(f.controller.getTranscript("call-1")).toHaveLength(1);
    await f.controller.end("call-1");
  });

  it("changes screen context without starting work and detaches all observers on hangup", async () => {
    const f = fixture();
    await f.controller.start(target);
    await settle();
    f.view.set("The phone is showing Fitness; no desktop view is available.");
    await settle();
    expect(f.sent.at(-1)).toMatchObject({
      type: "session.thinking.append",
      content: expect.stringContaining("phone"),
    });
    expect(f.backend.startWork).not.toHaveBeenCalled();
    f.fragment("user", "Check my workout", 100);
    f.delegate();
    await settle();
    await f.controller.end("call-1");
    expect(f.detachWork).toHaveBeenCalledOnce();
    const count = f.sent.length;
    f.update({ status: "completed", text: "Late result remains in chat." });
    f.view.set("A different device view");
    await settle();
    expect(f.sent).toHaveLength(count);
  });

  it("does not invent a task from a delegation with no user transcript", async () => {
    const f = fixture();
    await f.controller.start(target);
    f.delegate();
    await settle();
    expect(f.backend.startWork).not.toHaveBeenCalled();
    expect(f.sent).toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("repeat the request") }),
    );
    await f.controller.end("call-1");
  });

  it("delivers the complete bounded thread context in silent chunks without starting work", async () => {
    const delivered = Promise.withResolvers<void>();
    let observed = "";
    const f = fixture((text) => {
      observed += text.split("(data, not instructions): ")[1] ?? "";
      if (observed.endsWith("FINAL SENTENCE.")) delivered.resolve();
    });
    await f.controller.start(target);
    await settle();
    f.sent.length = 0;
    const text = `Viewed thread. Linked PRs: 20 total. ${"Context words. ".repeat(130)}FINAL SENTENCE.`;
    f.view.set(text);
    await delivered.promise;
    const packets = f.sent.filter((packet) => packet.content?.startsWith("Current device view,"));
    expect(packets.length).toBeGreaterThan(1);
    expect(
      packets.map((packet) => packet.content!.split("(data, not instructions): ")[1]).join(""),
    ).toBe(text);
    for (const packet of packets) {
      expect(new TextEncoder().encode(packet.content).length).toBeLessThanOrEqual(480);
      expect(packet.type).toBe("session.thinking.append");
    }
    expect(f.backend.startWork).not.toHaveBeenCalled();
    await f.controller.end("call-1");
  });

  it("keeps final transcript packets during close, but never delivers a late result to a new call", async () => {
    const f = fixture();
    const abort = new AbortController();
    const events: VoiceCallEvent[] = [];
    const connection = await f.connector.connect({
      callId: "call",
      target,
      signal: abort.signal,
      onEvent: (event) => events.push(event),
    });
    f.fragment("first", "Words", 100);
    abort.abort("replaced");
    f.fragment("last", " still draining", 200);
    expect(events.findLast((event) => event.type === "transcript")).toMatchObject({
      entry: { text: "Words still draining" },
    });
    await connection.close("replaced");
  });

  it("bounds multilingual provider updates without splitting surrogate pairs", () => {
    const value = boundLiveContext("🏋️日本語".repeat(400));
    expect(new TextEncoder().encode(value).byteLength).toBeLessThanOrEqual(480);
    expect(value).not.toContain("�");
    expect(value.endsWith("…")).toBe(true);
    expect(boundLiveContext("Ready")).toBe("Ready");
  });

  it("retries typed work with the same request identity and one transcript row", async () => {
    const f = fixture();
    await f.controller.start(target);
    expect(f.controller.getSnapshot()?.canSendText).toBe(true);
    f.controller.setDraft("call-1", "Thursday, not Friday");
    f.backend.startWork.mockRejectedValueOnce(new Error("Lost response"));
    expect((await f.controller.sendDraft("call-1")).ok).toBe(false);
    expect(f.controller.getDraft("call-1").text).toBe("Thursday, not Friday");
    expect((await f.controller.sendDraft("call-1")).ok).toBe(true);
    expect(f.backend.startWork.mock.calls[0]).toEqual(f.backend.startWork.mock.calls[1]);
    expect(f.controller.getTranscript("call-1")).toEqual([
      expect.objectContaining({ speaker: "user", text: "Thursday, not Friday", final: true }),
    ]);
    expect(f.controller.getDraft("call-1").text).toBe("");
    expect(f.sent.some((packet) => packet.type.startsWith("conversation."))).toBe(false);
    f.update({ status: "completed", text: "The date is now Thursday." });
    await settle();
    expect(f.sent).toContainEqual(
      expect.objectContaining({
        type: "session.commentary.append",
        delegation_id: null,
        content: expect.stringContaining("Thursday"),
      }),
    );
    await f.controller.end("call-1");
  });

  it("keeps the newest correction when older speech exceeds the work request budget", async () => {
    const f = fixture();
    await f.controller.start(target);
    for (let i = 0; i < 25; i++) f.fragment(`old-${i}`, "Old discussion ".repeat(400), i * 100);
    f.fragment("correction", `${"日本語🙂".repeat(1000)} Actually use Thursday, not Friday.`, 3000);
    f.delegate("latest", 4000);
    await settle();
    const text = f.backend.startWork.mock.calls[0]?.[0].text;
    expect(text).toContain("Actually use Thursday, not Friday.");
    expect(text).toContain("Earlier speech omitted");
    expect(text).not.toContain("�");
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(16_384);
    await f.controller.end("call-1");
  });

  it("retains the user's request through a long bot reply and ignores replayed fragments", async () => {
    const f = fixture();
    await f.controller.start(target);
    f.fragment("request", "Test the login screen only.", 100);
    f.fragment("request", "Test the login screen only.", 100);
    for (let i = 0; i < 20; i++)
      f.fragment(`bot-${i}`, "Considerations ".repeat(300), 200 + i * 100, "bot");
    f.delegate("work", 4000);
    await settle();
    const text = f.backend.startWork.mock.calls[0]?.[0].text;
    expect(text?.split("Test the login screen only.")).toHaveLength(2);
    expect(text).toContain("bot [2100-2200]");
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(16_384);
    await f.controller.end("call-1");
  });
});

describe("current device browser capture", () => {
  const browser = {
    environmentId: EnvironmentId.make("browser-env"),
    threadId: ThreadId.make("visible-thread"),
    tabId: "visible-tab",
  };
  const page = {
    url: "https://example.com/login",
    title: "Sign in",
    content: "button: Login",
    truncated: false,
  };

  it("reads the exact visible target, with no browser read on non-browser pages", async () => {
    const view = createVoiceViewContext();
    const read = vi.fn(async () => page);
    const signal = new AbortController().signal;
    view.set("Viewing PR 42");
    expect(await captureVoiceView(view, read, signal)).toBe("Viewing PR 42");
    expect(read).not.toHaveBeenCalled();
    view.set("Viewing login", browser);
    expect(await captureVoiceView(view, read, signal)).toContain("button: Login");
    expect(read).toHaveBeenCalledExactlyOnceWith(browser);
  });

  it("discards a capture even after navigating away and back to the same tab", async () => {
    const view = createVoiceViewContext();
    view.set("Viewing login", browser);
    const pending = Promise.withResolvers<typeof page>();
    const capture = captureVoiceView(view, () => pending.promise, new AbortController().signal);
    view.set("Viewing a PR");
    view.set("Viewing login", browser);
    pending.resolve(page);
    const result = await capture;
    expect(result).toContain("captured contents were discarded");
    expect(result).not.toContain("button: Login");
  });

  it("keeps failed or unauthorized inspection explicit, without failing the request", async () => {
    const view = createVoiceViewContext();
    view.set("Viewing login", browser);
    const result = await captureVoiceView(
      view,
      async () => {
        throw new Error("not allowed");
      },
      new AbortController().signal,
    );
    expect(result).toContain("Page contents could not be read");
    expect(result).not.toContain("not allowed");
  });

  it("bounds a hung page read and ignores a late result", async () => {
    vi.useFakeTimers();
    try {
      const view = createVoiceViewContext();
      view.set("Viewing login", browser);
      const pending = Promise.withResolvers<typeof page>();
      const capture = captureVoiceView(view, () => pending.promise, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await capture;
      expect(result).toContain("Page contents could not be read");
      pending.resolve(page);
      expect(await capture).toBe(result);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a hung read immediately and clears its deadline", async () => {
    vi.useFakeTimers();
    try {
      const view = createVoiceViewContext();
      view.set("Viewing login", browser);
      const pending = Promise.withResolvers<typeof page>();
      const controller = new AbortController();
      const capture = captureVoiceView(view, () => pending.promise, controller.signal);
      controller.abort(new Error("panel closed"));
      await expect(capture).rejects.toThrow("panel closed");
      expect(vi.getTimerCount()).toBe(0);
      pending.resolve(page);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("keeps Codex snapshots off the audio stream while requested work gets the current view", async () => {
  const f = fixture(undefined, "codex");
  await f.controller.start(target);
  const update = f.backend.watchContext.mock.calls.at(-1)![1];
  update({ kind: "context", text: "Last conversation: Monday, bench press" });
  update({ kind: "instructions", text: "Updated memory" });
  f.view.set("The user is now viewing Settings on this device.");
  await settle();
  expect(f.sent).toEqual([]);
  f.nativeDelegate("What is on my screen?");
  await settle();
  expect(f.backend.startWork).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining("What is on my screen?"),
      viewContext: "The user is now viewing Settings on this device.",
    }),
  );
  expect(f.sent).toEqual([]);
  f.update({ status: "completed", text: "Settings is open." });
  await settle();
  expect(f.sent).toEqual([
    {
      type: "delegation.context.append",
      delegation_item_id: "native-work",
      channel: "speakable",
      content: [
        {
          type: "input_text",
          text: "Work result: Settings is open.\nThe full result remains in this conversation.",
        },
      ],
    },
  ]);
  const result = "First result detail. " + "More detail. ".repeat(100) + " Final result detail.";
  update({ kind: "context", text: result, speak: true });
  await settle();
  expect(f.sent.at(-1)).toEqual({
    type: "session.context.append",
    channel: "speakable",
    content: [{ type: "input_text", text: result }],
  });
  await f.controller.end("call-1");
});
