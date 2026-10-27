import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { LiveSession } from "./live-session.ts";

function fixture() {
  let id = 0;
  const sent: Array<Record<string, unknown>> = [];
  const callbacks = {
    onTranscript: vi.fn(),
    onUntimedTranscript: vi.fn(),
    onDelegation: vi.fn(),
    onClosed: vi.fn(),
    onFailure: vi.fn(),
  };
  const session = new LiveSession({
    createEventId: () => `command-${++id}`,
    send: (packet) => {
      sent.push(JSON.parse(packet));
    },
    callbacks,
  });
  const receive = (event: object) => session.receive(JSON.stringify(event));
  const start = () => receive({ type: "session.started", session: { id: "live-1" } });
  return { session, sent, callbacks, receive, start };
}

afterEach(() => vi.useRealTimers());

describe("GPT Live control protocol", () => {
  it("waits for session.started without sending a duplicate session.start", async () => {
    const { session, sent, start } = fixture();
    await expect(session.setMuted(true)).rejects.toThrow("not ready");
    start();
    expect(await session.ready()).toBe("live-1");
    expect(sent).toEqual([]);
  });

  it("preserves speech fragments, timing, repeated words, and overlapping speakers", () => {
    const { callbacks, receive, start } = fixture();
    start();
    const first = {
      type: "session.input_transcript.delta",
      event_id: "a",
      delta: "I, I",
      start_ms: 50,
      end_ms: 150,
    };
    receive(first);
    receive({
      type: "session.output_transcript.delta",
      event_id: "b",
      delta: "Yes",
      start_ms: 100,
      end_ms: 180,
    });
    receive({ ...first, event_id: "c", delta: " mean login", start_ms: 150, end_ms: 300 });
    receive(first);
    expect(callbacks.onTranscript.mock.calls.map(([fragment]) => fragment)).toEqual([
      { id: "a", speaker: "user", text: "I, I", startMs: 50, endMs: 150 },
      { id: "b", speaker: "bot", text: "Yes", startMs: 100, endMs: 180 },
      { id: "c", speaker: "user", text: " mean login", startMs: 150, endMs: 300 },
    ]);
  });

  it("only accepts the matching microphone acknowledgment", async () => {
    const { session, receive, start } = fixture();
    start();
    let done = false;
    const pending = session.setMuted(true).then(() => {
      done = true;
    });
    receive({ type: "session.input_audio.unmuted", client_event_id: "command-1" });
    receive({ type: "session.input_audio.muted", client_event_id: "old-command" });
    await Promise.resolve();
    expect(done).toBe(false);
    receive({ type: "session.input_audio.muted", client_event_id: "command-1" });
    await pending;
    expect(done).toBe(true);
  });

  it("keeps a command rejection separate from a broken call and never exposes upstream text", async () => {
    const { session, receive, start, callbacks } = fixture();
    start();
    const pending = session.setMuted(false);
    receive({
      type: "error",
      error: { client_event_id: "command-1", message: "private provider text" },
    });
    await expect(pending).rejects.toThrow("did not accept this update");
    expect(callbacks.onFailure).not.toHaveBeenCalled();
    const next = session.setMuted(true);
    receive({ type: "session.input_audio.muted", client_event_id: "command-2" });
    await next;
  });

  it("deduplicates delegation and retains the provider id for task results", async () => {
    const { session, receive, start, callbacks, sent } = fixture();
    start();
    const event = {
      type: "session.delegation.created",
      offset_ms: 1200,
      delegation: { id: "task-1", target: "client" },
    };
    receive(event);
    receive(event);
    expect(callbacks.onDelegation).toHaveBeenCalledExactlyOnceWith({
      id: "task-1",
      offsetMs: 1200,
    });
    await expect(
      session.appendContext({ text: "Ready", delegationId: "other-session-task" }),
    ).rejects.toThrow("different voice session");
    const pending = session.appendContext({
      text: "The screenshot is ready.",
      delegationId: "task-1",
      speak: true,
    });
    expect(sent[0]).toMatchObject({
      type: "session.commentary.append",
      delegation_id: "task-1",
      content: "The screenshot is ready.",
    });
    receive({ type: "session.commentary.appended", client_event_id: "command-1" });
    await pending;
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it("accepts final transcript packets during graceful close but starts no more work", async () => {
    const { session, receive, start, callbacks, sent } = fixture();
    start();
    const closing = session.close();
    expect(session.close()).toBe(closing);
    await expect(session.appendContext({ text: "Too late" })).rejects.toThrow("not ready");
    receive({
      type: "session.delegation.created",
      offset_ms: 50,
      delegation: { id: "late", target: "client" },
    });
    receive({
      type: "session.output_transcript.delta",
      event_id: "last",
      delta: "Goodbye.",
      start_ms: 10,
      end_ms: 50,
    });
    expect(callbacks.onTranscript).toHaveBeenCalledOnce();
    expect(callbacks.onDelegation).not.toHaveBeenCalled();
    receive({ type: "session.closed", reason: "close_requested" });
    await closing;
    expect(sent).toEqual([{ type: "session.close", event_id: "command-1" }]);
    expect(callbacks.onClosed).toHaveBeenCalledExactlyOnceWith("close_requested");
    session.fail("A late socket close");
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("marks missing finalization as unconfirmed and releases every pending command", async () => {
    vi.useFakeTimers();
    const { session, start, callbacks } = fixture();
    start();
    const pending = session.setMuted(true);
    const pendingCheck = expect(pending).rejects.toThrow("ended before this update");
    const closedCheck = expect(session.close()).rejects.toThrow("finalization was not confirmed");
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([pendingCheck, closedCheck]);
    expect(callbacks.onFailure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores unknown events but rejects malformed known events without leaking their content", async () => {
    const { session, receive, start, callbacks } = fixture();
    start();
    receive({ type: "session.future_event", value: "safe to ignore" });
    expect(callbacks.onFailure).not.toHaveBeenCalled();
    receive({
      type: "session.input_transcript.delta",
      delta: "private",
      event_id: "x",
      start_ms: 3,
      end_ms: 1,
    });
    expect(callbacks.onFailure).toHaveBeenCalledExactlyOnceWith(
      "The voice provider sent an invalid session event.",
    );
    await expect(session.setMuted(true)).rejects.toThrow("not ready");
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });
});

describe("Codex subscription voice protocol", () => {
  it("keeps background context and instructions quiet, with only requested results speakable", async () => {
    const f = fixture();
    f.session.setProtocol("codex");
    f.start();
    await f.session.appendContext({ text: "Workout plan ready." });
    await f.session.appendInstructions("Keep responses concise.");
    await f.session.appendContext({ text: "The user changed screens.", speak: false });
    expect(f.sent).toEqual(
      ["Workout plan ready.", "Keep responses concise.", "The user changed screens."].map(
        (text) => ({
          type: "session.context.append",
          channel: "commentary",
          content: [{ type: "input_text", text }],
        }),
      ),
    );
    await f.session.appendContext({ text: "Your requested result.", speak: true });
    expect(f.sent.at(-1)).toEqual({
      type: "session.context.append",
      channel: "speakable",
      content: [{ type: "input_text", text: "Your requested result." }],
    });
  });

  it("preserves transcript corrections and delegates to T3 without native Codex turns", async () => {
    const f = fixture();
    f.session.setProtocol("codex");
    f.start();
    f.receive({ type: "input_transcript.added", item: { text: "Use the old address" } });
    f.receive({ type: "turn.done", turn: { role: "user", transcript: "Use the new address" } });
    expect(f.callbacks.onUntimedTranscript.mock.calls.map(([entry]) => entry)).toEqual([
      { id: "codex-user-0", speaker: "user", text: "Use the old address", final: false },
      { id: "codex-user-0", speaker: "user", text: "Use the new address", final: true },
    ]);
    const event = {
      type: "delegation.created",
      item: {
        id: "delegation",
        type: "delegation",
        target: "client",
        content: [{ type: "input_text", text: "Save the corrected address." }],
      },
    };
    f.receive(event);
    f.receive(event);
    expect(f.callbacks.onDelegation).toHaveBeenCalledExactlyOnceWith({
      id: "delegation",
      offsetMs: 0,
      text: "Save the corrected address.",
    });
    await f.session.appendContext({
      delegationId: "delegation",
      text: "Address saved.",
      speak: true,
    });
    expect(f.sent).toContainEqual({
      type: "delegation.context.append",
      delegation_item_id: "delegation",
      channel: "speakable",
      content: [{ type: "input_text", text: "Address saved." }],
    });
    await f.session.setMuted(true);
    expect(f.sent).toHaveLength(1);
    vi.useFakeTimers();
    const closed = f.session.close();
    await vi.advanceTimersByTimeAsync(1500);
    await closed;
    expect(f.callbacks.onFailure).not.toHaveBeenCalled();
  });
});
