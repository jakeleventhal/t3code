import { EnvironmentId, MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createGrokVoiceConnector, type VoiceSocket } from "./grok-connector.ts";
import { createVoiceViewContext, type VoiceWorkUpdate } from "./live-connector.ts";
import type { VoiceCallEvent, VoiceCallTarget } from "./controller.ts";
import type { PcmAudioFactory, PcmPlaybackPosition } from "./pcm-audio.ts";

const target: VoiceCallTarget = {
  environmentId: EnvironmentId.make("env"),
  bot: { id: "fitness", title: "Fitness", botRole: "assistant" },
  threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
};
async function fixture() {
  const sent: Record<string, unknown>[] = [];
  const listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  const emit = (packet: object) =>
    listeners.get("message")?.forEach((listener) => listener({ data: JSON.stringify(packet) }));
  let audioInput!: Parameters<PcmAudioFactory>[0];
  let update!: (value: VoiceWorkUpdate) => void;
  const events: VoiceCallEvent[] = [];
  const detach = vi.fn();
  const socket: VoiceSocket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (packet) => {
      const value = JSON.parse(packet) as Record<string, unknown>;
      sent.push(value);
      if (value.type === "session.update") queueMicrotask(() => emit({ type: "session.updated" }));
    },
    close: vi.fn(),
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  const audio = {
    start: vi.fn(async () => undefined),
    enqueue: vi.fn(),
    clear: vi.fn<() => PcmPlaybackPosition | null>(() => null),
    setMuted: vi.fn(),
    close: vi.fn(),
  };
  const startWork = vi.fn(async () => ({
    threadId: target.threadRef.threadId,
    runId: RunId.make("work"),
    messageId: MessageId.make("request"),
  }));
  const abort = new AbortController();
  const connector = createGrokVoiceConnector({
    view: createVoiceViewContext(),
    createSocket: (url, protocols) => {
      expect(url).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-3.0");
      expect(protocols).toEqual(["xai-client-secret.short-lived"]);
      queueMicrotask(() => listeners.get("open")?.forEach((listener) => listener({ data: null })));
      return socket;
    },
    openPcmAudio: (input) => {
      audioInput = input;
      return audio;
    },
    backend: {
      negotiate: async () => ({
        kind: "grok",
        clientSecret: "short-lived",
        expiresAt: 9999999999,
        model: "grok-voice-3.0",
        voice: "eve",
        context: {
          instructions: "Remember the main conversation.",
          history: [{ role: "user", text: "My gym is Cedar Gate." }],
        },
      }),
      captureView: async () => "Current device: workout plan.",
      startWork,
      watchWork: (_target, _work, callback) => {
        update = callback;
        return detach;
      },
    },
  });
  const connection = await connector.connect({
    callId: "call",
    endpointId: "phone",
    target,
    signal: abort.signal,
    onEvent: (event) => events.push(event),
  });
  return {
    connection,
    sent,
    emit,
    events,
    audio,
    audioInput,
    startWork,
    update: (value: VoiceWorkUpdate) => update(value),
    detach,
    abort,
  };
}
async function settle() {
  for (let n = 0; n < 8; n++) await Promise.resolve();
}

describe("Grok direct voice", () => {
  it("streams PCM and persists cumulative ASR corrections without duplicating lines", async () => {
    const f = await fixture();
    f.audioInput.onAudio("AAEAAg==");
    expect(f.sent).toContainEqual({ type: "input_audio_buffer.append", audio: "AAEAAg==" });
    f.emit({
      type: "conversation.item.input_audio_transcription.updated",
      item_id: "user-1",
      transcript: "at Cedar",
    });
    f.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-1",
      transcript: "at Cedar Gate",
    });
    const entries = f.events
      .filter((event) => event.type === "transcript")
      .map((event) => event.entry);
    expect(entries).toMatchObject([
      { id: "user-1", ordinal: 0, revision: 0, final: false },
      { id: "user-1", ordinal: 0, revision: 1, text: "at Cedar Gate", final: true },
    ]);
    await f.connection.close("user");
    expect(f.audio.close).toHaveBeenCalled();
  });

  it("truncates at actual playback and ignores cancelled audio and stale text finals", async () => {
    const f = await fixture();
    f.emit({ type: "response.created", response: { id: "response-1" } });
    f.emit({
      type: "response.output_audio.delta",
      item_id: "reply",
      response_id: "response-1",
      delta: "AAEAAg==",
    });
    f.emit({
      type: "response.output_audio_transcript.done",
      item_id: "reply",
      transcript: "Heard and unheard",
    });
    f.audio.clear.mockReturnValueOnce({ itemId: "reply", playedMs: 123.8 });
    f.emit({ type: "input_audio_buffer.speech_started", item_id: "user-2" });
    expect(f.sent).toContainEqual({
      type: "conversation.item.truncate",
      item_id: "reply",
      content_index: 0,
      audio_end_ms: 123,
    });
    f.emit({
      type: "response.output_audio.delta",
      item_id: "reply",
      response_id: "response-1",
      delta: "AAAA",
    });
    f.emit({ type: "conversation.item.truncated", item_id: "reply", transcript: "Heard" });
    f.emit({
      type: "response.output_audio_transcript.done",
      item_id: "reply",
      transcript: "Heard and unheard",
    });
    f.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-2",
      transcript: "Correction",
    });
    expect(f.audio.enqueue).toHaveBeenCalledTimes(1);
    expect(
      f.events.findLast((event) => event.type === "transcript" && event.entry.id === "reply"),
    ).toMatchObject({ entry: { text: "Heard", final: true, revision: 1 } });
    await f.connection.close("user");
  });

  it("delegates once and waits for a natural pause to speak completed work", async () => {
    const f = await fixture();
    f.emit({ type: "response.created", response: { id: "response-1" } });
    const request = {
      type: "response.function_call_arguments.done",
      call_id: "request-1",
      name: "delegate_work",
      arguments: JSON.stringify({ request: "Look up my gym from Main." }),
    };
    f.emit(request);
    f.emit(request);
    await settle();
    expect(f.startWork).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        requestId: "request-1",
        text: "Look up my gym from Main.",
        endpointId: "phone",
        viewContext: "Current device: workout plan.",
      }),
    );
    f.emit({ type: "response.output_audio.delta", item_id: "reply", delta: "AAAA" });
    f.update({ status: "completed", text: "Your gym is Cedar Gate." });
    f.emit({ type: "response.done", response: { id: "response-1" } });
    expect(f.sent.filter((event) => event.type === "response.create")).toHaveLength(0);
    f.audioInput.onPlaybackIdle();
    expect(f.sent.filter((event) => event.type === "response.create")).toHaveLength(1);
    await f.connection.close("user");
    expect(f.detach).toHaveBeenCalledOnce();
    const count = f.sent.length;
    f.update({ status: "completed", text: "Late result remains in chat." });
    expect(f.sent).toHaveLength(count);
  });
});
