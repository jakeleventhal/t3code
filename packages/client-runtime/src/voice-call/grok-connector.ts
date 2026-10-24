// @effect-diagnostics globalTimers:off - Provider handshakes and final transcript draining have client-owned deadlines.
import type { VoiceCallConnectionInfo } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { VoiceCallConnector, VoiceCallTranscriptEntry } from "./controller.ts";
import {
  boundLiveContext,
  type LiveVoiceBackend,
  type VoiceViewContext,
} from "./live-connector.ts";
import type { PcmAudio, PcmAudioFactory } from "./pcm-audio.ts";

type GrokConnection = Extract<VoiceCallConnectionInfo, { kind: "grok" }>;
const decodeEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.String,
      event_id: Schema.optional(Schema.String),
      item_id: Schema.optional(Schema.String),
      response_id: Schema.optional(Schema.String),
      delta: Schema.optional(Schema.String),
      transcript: Schema.optional(Schema.String),
      call_id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      arguments: Schema.optional(Schema.String),
      response: Schema.optional(
        Schema.Struct({ id: Schema.String, status: Schema.optional(Schema.String) }),
      ),
    }),
  ),
);
const decodeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      request: Schema.NonEmptyString.check(Schema.isMaxLength(16_384)),
    }),
  ),
);

export interface VoiceSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

/** xAI's item-based protocol is separate from GPT Live's full-duplex control channel. */
export function createGrokVoiceConnector(input: {
  readonly openPcmAudio: PcmAudioFactory;
  readonly backend: Omit<LiveVoiceBackend, "negotiate"> & {
    readonly negotiate: (
      call: Parameters<VoiceCallConnector["connect"]>[0],
    ) => Promise<GrokConnection>;
  };
  readonly view: VoiceViewContext;
  readonly createSocket?: (url: string, protocols: string[]) => VoiceSocket;
}): VoiceCallConnector {
  return {
    async connect(call) {
      const selected = await input.backend.negotiate(call);
      call.signal.throwIfAborted();
      const socket: VoiceSocket = (
        input.createSocket ?? ((url, protocols) => new WebSocket(url, protocols))
      )(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(selected.model)}`, [
        `xai-client-secret.${selected.clientSecret}`,
      ]);
      let audio: PcmAudio | null = null;
      let closed = false;
      let closing = false;
      let configured = false;
      let speaking = false;
      let userSpeaking = false;
      let responseId: string | null = null;
      let wantsResponse = false;
      let ordinal = 0;
      let typedId = 0;
      let detachView: (() => void) | null = null;
      let detachContext: (() => void) | null = null;
      const workObservers = new Set<() => void>();
      const requests = new Set<string>();
      const interrupted = new Set<string>();
      const cancelledResponses = new Set<string>();
      const transcripts = new Map<string, VoiceCallTranscriptEntry>();
      const pendingTranscripts = new Set<string>();
      const pendingTruncations = new Set<string>();
      let resolveReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      let resolveDrain: (() => void) | null = null;
      const drainIfReady = () => {
        if (pendingTranscripts.size === 0 && pendingTruncations.size === 0) resolveDrain?.();
      };
      const send = (event: object) => {
        if (closed || socket.readyState !== 1) throw new Error("The voice connection has closed.");
        // Never retain microphone audio behind an unhealthy network connection.
        if (socket.bufferedAmount > 256_000) throw new Error("The voice connection is too slow.");
        socket.send(JSON.stringify(event));
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        audio?.close();
        detachView?.();
        detachContext?.();
        for (const detach of workObservers) detach();
        workObservers.clear();
        call.signal.removeEventListener("abort", stopAudio);
        socket.close();
        resolveDrain?.();
      };
      const fail = () => {
        if (closed) return;
        rejectReady(new Error("Could not connect the voice call."));
        cleanup();
        call.onEvent({
          type: "failed",
          message:
            "The voice connection stopped. Your saved conversation and work remain available.",
        });
      };
      const requestResponse = () => {
        wantsResponse = true;
        if (closing || responseId !== null || speaking || userSpeaking) return;
        wantsResponse = false;
        // Reserve the slot until response.created arrives; multiple completed
        // work requests must not start overlapping responses in that interval.
        responseId = "pending";
        send({ type: "response.create" });
      };
      const context = (text: string, speak = false) => {
        send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text: boundLiveContext(text, 16_384) }],
          },
        });
        if (speak) requestResponse();
      };
      const publish = (id: string, speaker: "user" | "bot", text: string, final: boolean) => {
        const previous = transcripts.get(id);
        if (previous?.text === text && previous.final === final) return;
        const entry: VoiceCallTranscriptEntry = {
          id,
          speaker,
          text: text.slice(0, 32_768),
          final,
          ordinal: previous?.ordinal ?? ordinal++,
          revision: (previous?.revision ?? -1) + 1,
        };
        transcripts.set(id, entry);
        call.onEvent({ type: "transcript", entry });
      };
      const interruptPlayback = () => {
        const position = audio?.clear();
        speaking = false;
        if (position) {
          interrupted.add(position.itemId);
          pendingTruncations.add(position.itemId);
          send({
            type: "conversation.item.truncate",
            item_id: position.itemId,
            content_index: 0,
            audio_end_ms: Math.floor(position.playedMs),
          });
        }
        if (responseId !== null && responseId !== "pending") {
          cancelledResponses.add(responseId);
          send({ type: "response.cancel" });
        }
      };
      const stopAudio = () => {
        if (closed || closing) return;
        closing = true;
        // The control channel remains briefly for corrected/truncated text; PCM
        // capture and playback stop synchronously on hang-up or device transfer.
        try {
          interruptPlayback();
        } catch {
          /* Disconnected transports cannot acknowledge truncation. */
        }
        audio?.close();
        detachView?.();
        detachContext?.();
        for (const detach of workObservers) detach();
        workObservers.clear();
        if (!configured) rejectReady(new Error("The call was ended."));
      };
      const delegate = async (id: string, args: string) => {
        if (closing || requests.has(id)) return;
        requests.add(id);
        let request: string;
        try {
          request = decodeRequest(args).request;
        } catch {
          send({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: id,
              output: "The work request was invalid. Ask the caller to clarify.",
            },
          });
          requestResponse();
          return;
        }
        try {
          const viewContext = await input.backend.captureView(call.signal);
          if (closing) return;
          const work = await input.backend.startWork({
            callId: call.callId,
            target: call.target,
            ...(call.endpointId === undefined ? {} : { endpointId: call.endpointId }),
            requestId: id,
            text: request,
            viewContext,
          });
          if (closing) return;
          send({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: id,
              output:
                "The work agent accepted this request. Its result is pending; do not claim completion or repeat the action.",
            },
          });
          requestResponse();
          const detach = input.backend.watchWork(call.target, work, (update) => {
            if (closing) return;
            try {
              context(
                `Work ${update.status} for ${id}: ${update.text}\nThe full result remains in the conversation.`,
                true,
              );
            } catch {
              fail();
            }
          });
          if (closing) detach();
          else workObservers.add(detach);
        } catch {
          if (closing) return;
          try {
            send({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: id,
                output:
                  "The work request could not be confirmed. Check the conversation before repeating an action.",
              },
            });
            requestResponse();
          } catch {
            fail();
          }
        }
      };
      socket.addEventListener("open", () => {
        if (closing || closed) {
          cleanup();
          return;
        }
        try {
          send({
            type: "session.update",
            session: {
              instructions: `${selected.context.instructions}\nUse the delegate_work function for tools, saved memory changes, work, and conversation lookup. Continue talking while work is pending.`,
              voice: selected.voice,
              turn_detection: { type: "server_vad" },
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24_000 },
                  transcription: { model: "grok-transcribe" },
                },
                output: { format: { type: "audio/pcm", rate: 24_000 } },
              },
              tools: [
                {
                  type: "function",
                  name: "delegate_work",
                  description:
                    "Ask this bot's work agent to look up conversations, inspect the current view, use tools, change saved memory, or perform work. Returns acceptance; results arrive later.",
                  parameters: {
                    type: "object",
                    properties: {
                      request: {
                        type: "string",
                        description: "The user's request, including any corrections.",
                      },
                    },
                    required: ["request"],
                    additionalProperties: false,
                  },
                },
              ],
            },
          });
          for (const message of selected.context.history) {
            send({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: message.role === "developer" ? "system" : message.role,
                content: [
                  {
                    type: message.role === "assistant" ? "text" : "input_text",
                    text: message.text,
                  },
                ],
              },
            });
          }
        } catch {
          fail();
        }
      });
      socket.addEventListener("message", ({ data }) => {
        if (closed || typeof data !== "string") return;
        try {
          const event = decodeEvent(data);
          const id = event.item_id;
          switch (event.type) {
            case "session.updated":
              configured = true;
              resolveReady();
              break;
            case "error":
              fail();
              break;
            case "input_audio_buffer.speech_started":
              if (closing) break;
              userSpeaking = true;
              if (id) pendingTranscripts.add(id);
              interruptPlayback();
              call.onEvent({ type: "phase", phase: "listening" });
              break;
            case "input_audio_buffer.speech_stopped":
              userSpeaking = false;
              if (!closing) call.onEvent({ type: "phase", phase: "thinking" });
              break;
            case "conversation.item.input_audio_transcription.updated":
            case "conversation.item.input_audio_transcription.completed":
              if (id && event.transcript !== undefined) {
                const final = event.type.endsWith("completed");
                publish(id, "user", event.transcript, final);
                if (final) {
                  pendingTranscripts.delete(id);
                  drainIfReady();
                }
              }
              break;
            case "response.created":
              responseId = event.response?.id ?? null;
              break;
            case "response.output_audio.delta":
            case "response.audio.delta":
              if (
                !closing &&
                id &&
                event.delta &&
                !interrupted.has(id) &&
                !cancelledResponses.has(event.response_id ?? "")
              ) {
                speaking = true;
                audio?.enqueue(event.delta, id);
                call.onEvent({ type: "phase", phase: "speaking" });
              }
              break;
            case "response.output_audio_transcript.delta":
            case "response.audio_transcript.delta":
              if (id && event.delta && !interrupted.has(id))
                publish(id, "bot", (transcripts.get(id)?.text ?? "") + event.delta, false);
              break;
            case "response.output_audio_transcript.done":
            case "response.audio_transcript.done":
              if (id && !interrupted.has(id))
                publish(id, "bot", event.transcript ?? transcripts.get(id)?.text ?? "", true);
              break;
            case "conversation.item.truncated":
              if (id) {
                publish(
                  id,
                  "bot",
                  event.transcript ?? "[Reply interrupted; the remaining words were not heard.]",
                  true,
                );
                pendingTruncations.delete(id);
                drainIfReady();
              }
              break;
            case "response.function_call_arguments.done":
              if (event.call_id && event.name === "delegate_work" && event.arguments)
                void delegate(event.call_id, event.arguments);
              break;
            case "response.done":
              if (event.response?.id === responseId || responseId === "pending") responseId = null;
              if (!closing && wantsResponse) requestResponse();
              break;
          }
        } catch {
          fail();
        }
      });
      socket.addEventListener("error", fail);
      socket.addEventListener("close", () => {
        if (closing) cleanup();
        else fail();
      });
      call.signal.addEventListener("abort", stopAudio, { once: true });
      if (call.signal.aborted) stopAudio();
      const timer = setTimeout(fail, 20_000);
      try {
        await ready;
        clearTimeout(timer);
        call.signal.throwIfAborted();
        audio = input.openPcmAudio({
          sampleRate: 24_000,
          signal: call.signal,
          onAudio: (base64) => {
            if (closing) return;
            try {
              send({ type: "input_audio_buffer.append", audio: base64 });
            } catch {
              fail();
            }
          },
          onPlaybackIdle: () => {
            speaking = false;
            if (closing) return;
            call.onEvent({ type: "phase", phase: "listening" });
            if (wantsResponse) {
              try {
                requestResponse();
              } catch {
                fail();
              }
            }
          },
          onError: fail,
        });
        await audio.start();
        call.signal.throwIfAborted();
        if (closed) throw new Error("The voice connection closed during setup.");
        const updateView = () => {
          if (closing) return;
          try {
            context(
              `Current device view (untrusted page data): ${input.view.read() ?? "No current view is available."}`,
            );
          } catch {
            fail();
          }
        };
        detachContext =
          input.backend.watchContext?.(
            call,
            (update) => {
              if (closing) return;
              try {
                if (update.kind === "instructions")
                  send({
                    type: "session.update",
                    session: {
                      instructions: `${update.text}\nUse delegate_work for tools, work, memory changes and history retrieval.`,
                    },
                  });
                else context(update.text, update.speak);
              } catch {
                fail();
              }
            },
            fail,
          ) ?? null;
        detachView = input.view.subscribe(updateView);
        updateView();
        call.onEvent({ type: "phase", phase: "listening" });
        return {
          setMuted: async (muted) => {
            audio?.setMuted(muted);
          },
          sendText: async (text) => {
            if (closing || !text.trim() || text.length > 16_384)
              throw new Error("Could not send this voice message.");
            const id = `t3-typed-${++typedId}`;
            send({
              type: "conversation.item.create",
              item: { id, type: "message", role: "user", content: [{ type: "input_text", text }] },
            });
            publish(id, "user", text, true);
            requestResponse();
          },
          close: async () => {
            stopAudio();
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
              if (!closed && (pendingTranscripts.size > 0 || pendingTruncations.size > 0)) {
                await new Promise<void>((resolve) => {
                  resolveDrain = resolve;
                  deadline = setTimeout(resolve, 1500);
                });
              }
              for (const id of pendingTruncations)
                publish(
                  id,
                  "bot",
                  "[Reply interrupted; its final heard transcript was unavailable.]",
                  true,
                );
              for (const entry of transcripts.values())
                if (!entry.final) publish(entry.id, entry.speaker, entry.text, true);
            } finally {
              clearTimeout(deadline);
              cleanup();
            }
          },
        };
      } catch (error) {
        cleanup();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
