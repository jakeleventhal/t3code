import { describeCallWork } from "./activity-context.ts";
import {
  VoiceCallError,
  VoiceConnectionError,
  type OrchestrationV2ThreadProjection,
  type ScopedThreadRef,
  type VoiceCallContext,
  type VoiceCallWorkResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/reactivity";

import type { createBotVoiceEnvironmentAtoms } from "../state/bot-voice.ts";
import type { EnvironmentThreadState } from "../state/threadState.ts";
import { executeAtomQuery, squashAtomCommandFailure } from "../state/runtime.ts";
import {
  VoiceCallController,
  VoiceCallSetupError,
  type VoiceCallConnector,
  type VoiceCallEvent,
} from "./controller.ts";
import {
  captureVoiceView,
  createLiveVoiceConnector,
  type VoiceWorkUpdate,
  type LiveVoiceBackend,
} from "./live-connector.ts";
import { createGrokVoiceConnector } from "./grok-connector.ts";
import type { PcmAudioFactory } from "./pcm-audio.ts";
import { persistVoiceCalls } from "./persistence.ts";

export function createEnvironmentViewReader<R, E>(
  registry: AtomRegistry.AtomRegistry,
  commands: ReturnType<typeof createBotVoiceEnvironmentAtoms<R, E>>,
) {
  return (view: Parameters<typeof captureVoiceView>[0], signal: AbortSignal) =>
    captureVoiceView(
      view,
      async (target) => {
        const result = await commands.readBrowserPage.run(registry, {
          environmentId: target.environmentId,
          input: { threadId: target.threadId, tabId: target.tabId },
        });
        if (result._tag === "Success") return result.value;
        throw new Error("The current browser page could not be read.");
      },
      signal,
    );
}

const terminal = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);
const isSafeSetupError = Schema.is(Schema.Union([VoiceConnectionError, VoiceCallError]));
const isVoiceCallError = Schema.is(VoiceCallError);

type ContextProjection = {
  readonly messages: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["messages"][number],
      "id" | "runId" | "role" | "text" | "voiceCall" | "streaming"
    >
  >;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2ThreadProjection["runs"][number], "id" | "status">
  >;
};

export function createVoiceContextTracker(initial: ContextProjection | null) {
  let initialized = initial !== null;
  const messages = new Map(
    initial?.messages
      .filter((message) => !message.streaming)
      .map((message) => [message.id, message.text]),
  );
  const pending = new Set(
    initial?.runs.filter((run) => !terminal.has(run.status)).map((run) => run.id),
  );
  const watched = new Set(
    initial?.runs.filter((run) => terminal.has(run.status)).map((run) => run.id),
  );
  return (projection: ContextProjection) => {
    const updates: string[] = [];
    const work: Array<{
      runId: OrchestrationV2ThreadProjection["runs"][number]["id"];
      messageId: OrchestrationV2ThreadProjection["messages"][number]["id"];
    }> = [];
    for (const message of projection.messages) {
      if (message.voiceCall != null || message.streaming) continue;
      const previous = messages.get(message.id);
      messages.set(message.id, message.text);
      if (
        initialized &&
        previous !== message.text &&
        message.role === "user" &&
        !message.id.startsWith("voice-work:")
      )
        updates.push(
          `The user ${previous === undefined ? "typed" : "corrected"} a message in this conversation: ${message.text}`,
        );
    }
    for (const run of projection.runs) {
      if (watched.has(run.id)) continue;
      if (!initialized && terminal.has(run.status)) {
        watched.add(run.id);
        continue;
      }
      const request = projection.messages.find(
        (message) => message.runId === run.id && message.role === "user",
      );
      if (request === undefined) continue;
      watched.add(run.id);
      // The connector observes its own new delegations. Reattach work inherited
      // from the previous device, including work completed while audio connected.
      if (initialized && !pending.has(run.id) && request.id.startsWith("voice-work:")) continue;
      work.push({ runId: run.id, messageId: request.id });
    }
    initialized = true;
    return { updates, work };
  };
}

export function voiceWorkUpdate(
  projection: {
    readonly runs: ReadonlyArray<
      Pick<OrchestrationV2ThreadProjection["runs"][number], "id" | "status">
    >;
    readonly messages: ReadonlyArray<
      Pick<
        OrchestrationV2ThreadProjection["messages"][number],
        "runId" | "role" | "text" | "voiceCall" | "streaming"
      >
    >;
    readonly runtimeRequests: ReadonlyArray<
      Pick<OrchestrationV2ThreadProjection["runtimeRequests"][number], "nodeId" | "status">
    >;
    readonly nodes: ReadonlyArray<
      Pick<OrchestrationV2ThreadProjection["nodes"][number], "id" | "runId">
    >;
  },
  runId: string,
): VoiceWorkUpdate | null {
  const run = projection.runs.find((run) => run.id === runId);
  if (run === undefined) return null;
  if (run.status === "waiting") {
    return projection.runtimeRequests.some(
      (request) =>
        request.status === "pending" &&
        projection.nodes.some((node) => node.id === request.nodeId && node.runId === runId),
    )
      ? {
          status: "waiting",
          text: "The work agent needs an answer or approval in this conversation before it can continue.",
        }
      : null;
  }
  if (!terminal.has(run.status)) return null;
  if (projection.messages.some((message) => message.runId === runId && message.streaming))
    return null;
  const text = projection.messages
    .findLast(
      (message) =>
        message.runId === runId && message.role === "assistant" && message.voiceCall == null,
    )
    ?.text.trim();
  return {
    status:
      run.status === "completed" && text
        ? "completed"
        : run.status === "failed" || run.status === "completed"
          ? "failed"
          : "cancelled",
    text:
      text ||
      (run.status === "completed"
        ? "The work stopped without an answer. Tell the user the check did not return a result; do not claim you are still checking or that a result is available."
        : "The work did not complete. See the conversation for details."),
  };
}

/** Uses the clients' existing guarded commands and shared thread stream, never raw RPCs. */
export function createEnvironmentVoiceRuntime<R, E>(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly commands: ReturnType<typeof createBotVoiceEnvironmentAtoms<R, E>>;
  readonly threadState: (
    ref: ScopedThreadRef,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentThreadState, unknown>>;
  readonly activityContext?: Atom.Atom<string>;
  readonly endpointId: string;
  readonly createCallId: () => string;
  readonly openPcmAudio?: PcmAudioFactory;
  readonly openMedia: Parameters<typeof createLiveVoiceConnector>[0]["openMedia"];
  readonly view: Parameters<typeof createLiveVoiceConnector>[0]["view"];
}) {
  const { registry, commands, endpointId } = input;
  const readView = createEnvironmentViewReader(registry, commands);
  const unwrap = <A, B>(result: AsyncResult.AsyncResult<A, B>): A => {
    if (result._tag === "Success") return result.value;
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      if (isSafeSetupError(error)) throw new VoiceCallSetupError(error.message);
      throw error;
    }
    throw new Error("The voice request did not finish.");
  };
  const observe = (ref: ScopedThreadRef, callback: (state: EnvironmentThreadState) => void) =>
    registry.subscribe(
      input.threadState(ref),
      (result) => {
        const state = Option.getOrNull(AsyncResult.value(result));
        if (state !== null) callback(state);
      },
      { immediate: true },
    );
  const connecting = new Map<
    string,
    { instructions: string; track: ReturnType<typeof createVoiceContextTracker> }
  >();
  const backend: LiveVoiceBackend = {
    watchContext: (call, onUpdate, onFailure) => {
      const initial = connecting.get(call.endpointId ?? call.callId);
      let instructions = initial?.instructions;
      const track = initial?.track ?? createVoiceContextTracker(null);
      connecting.delete(call.endpointId ?? call.callId);
      let disposed = false;
      const workObservers = new Set<() => void>();
      const detachMemory = registry.subscribe(
        commands.observeContext({
          environmentId: call.target.environmentId,
          input: {
            threadId: call.target.threadRef.threadId,
            callId: call.callId,
            endpointId: call.endpointId ?? endpointId,
          },
        }),
        (result) => {
          if (disposed) return;
          if (result._tag === "Failure") {
            const error = squashAtomCommandFailure(result);
            if (
              isVoiceCallError(error) &&
              (error.reason === "owner-changed" || error.reason === "ended")
            )
              call.onEvent({
                type: "ended",
                reason: error.reason === "owner-changed" ? "replaced" : "interrupted",
              });
            else onFailure();
            return;
          }
          const value = Option.getOrNull(AsyncResult.value(result));
          if (value !== null && value !== instructions) {
            instructions = value;
            onUpdate({ kind: "instructions", text: value });
          }
        },
        { immediate: true },
      );
      const detachActivity =
        input.activityContext === undefined
          ? undefined
          : registry.subscribe(
              input.activityContext,
              (text) => {
                if (!disposed) onUpdate({ kind: "context", text });
              },
              { immediate: true },
            );
      let lastCallWork: string | undefined;
      const detachThread = observe(call.target.threadRef, (state) => {
        if (disposed || state.status !== "live" || Option.isNone(state.data)) return;
        const callWork = describeCallWork(state.data.value);
        if (callWork !== lastCallWork) {
          lastCallWork = callWork;
          onUpdate({ kind: "context", text: callWork });
        }
        const changes = track(state.data.value);
        for (const text of changes.updates) onUpdate({ kind: "context", text });
        for (const result of changes.work) {
          const work: VoiceCallWorkResult = {
            threadId: call.target.threadRef.threadId,
            ...result,
          };
          workObservers.add(
            backend.watchWork(call.target, work, (update) => {
              if (!disposed)
                onUpdate({
                  kind: "context",
                  text: `Work ${update.status}: ${update.text}\nThe full result remains in this conversation.`,
                  speak: true,
                });
            }),
          );
        }
      });
      return () => {
        disposed = true;
        detachMemory();
        detachActivity?.();
        detachThread();
        for (const detach of workObservers) detach();
        workObservers.clear();
      };
    },
    captureView: (signal) => readView(input.view, signal),
    negotiate: async ({ callId, target, endpointId: writerId }, sdp, signal) => {
      signal.throwIfAborted();
      const result = unwrap(
        await commands.connect.run(registry, {
          environmentId: target.environmentId,
          input: {
            threadId: target.threadRef.threadId,
            callId,
            endpointId: writerId ?? endpointId,
            transport: { type: "webrtc", sdp },
          },
        }),
      );
      signal.throwIfAborted();
      if (result.kind !== "openai-live")
        throw new Error("The selected voice needs a different audio transport.");
      return result;
    },
    startWork: async ({ callId, target, endpointId: writerId, requestId, text, viewContext }) =>
      unwrap(
        await commands.startWork.run(registry, {
          environmentId: target.environmentId,
          input: {
            threadId: target.threadRef.threadId,
            callId,
            endpointId: writerId ?? endpointId,
            requestId,
            text,
            ...(viewContext === null ? {} : { viewContext }),
          },
        }),
      ),
    watchWork: (target, work, onUpdate) => {
      let previous: string | null = null;
      let done = false;
      let detach: (() => void) | undefined;
      detach = observe(target.threadRef, (state) => {
        if (done || state.status !== "live" || Option.isNone(state.data)) return;
        const update = voiceWorkUpdate(state.data.value, work.runId);
        if (update === null) {
          previous = null;
          return;
        }
        const key = JSON.stringify(update);
        if (key === previous) return;
        previous = key;
        done = update.status !== "waiting";
        onUpdate(update);
        if (done) detach?.();
      });
      if (done) detach();
      return detach;
    },
  };
  const live = createLiveVoiceConnector({ openMedia: input.openMedia, view: input.view, backend });
  const grok =
    input.openPcmAudio === undefined
      ? null
      : createGrokVoiceConnector({
          openPcmAudio: input.openPcmAudio,
          view: input.view,
          backend: {
            ...backend,
            negotiate: async (call) => {
              call.signal.throwIfAborted();
              const result = unwrap(
                await commands.connect.run(registry, {
                  environmentId: call.target.environmentId,
                  input: {
                    threadId: call.target.threadRef.threadId,
                    callId: call.callId,
                    endpointId: call.endpointId ?? endpointId,
                    transport: { type: "websocket" },
                  },
                }),
              );
              call.signal.throwIfAborted();
              if (result.kind !== "grok")
                throw new Error("The selected voice changed during setup.");
              return result;
            },
          },
        });
  const readContext = async (
    call: Parameters<VoiceCallConnector["connect"]>[0],
  ): Promise<VoiceCallContext> => {
    const state = Option.getOrNull(
      AsyncResult.value(registry.get(input.threadState(call.target.threadRef))),
    );
    const track = createVoiceContextTracker(
      state?.status === "live" ? Option.getOrNull(state.data) : null,
    );
    const result = unwrap(
      await commands.context.run(registry, {
        environmentId: call.target.environmentId,
        input: {
          threadId: call.target.threadRef.threadId,
          callId: call.callId,
          endpointId: call.endpointId ?? endpointId,
        },
      }),
    );
    call.signal.throwIfAborted();
    connecting.set(call.endpointId ?? call.callId, { instructions: result.instructions, track });
    return result;
  };
  const media: VoiceCallConnector = {
    async connect(call) {
      try {
        const context = await readContext(call);
        if (context.transport === "websocket") {
          if (grok === null)
            throw new VoiceCallSetupError(
              "This client does not support Grok audio. Update the app to make this call.",
            );
          return await grok.connect(call);
        }
        return await live.connect(call);
      } finally {
        connecting.delete(call.endpointId ?? call.callId);
      }
    },
  };
  const persisted = persistVoiceCalls({
    media,
    begin: async ({ callId, target, signal }) => {
      const active = unwrap(
        await executeAtomQuery(
          registry,
          commands.active({ environmentId: target.environmentId, input: {} }),
          { refresh: true, signal, reportFailure: false, reportDefect: false },
        ),
      );
      signal.throwIfAborted();
      // Picking up the same conversation is a device transfer. A different bot
      // on another device must be ended there, never silently replaced here.
      if (active !== null && active.threadId !== target.threadRef.threadId)
        throw new VoiceCallSetupError(
          "A different bot is on a call on this environment. End that call first.",
        );
      const writer = {
        environmentId: target.environmentId,
        input: {
          threadId: target.threadRef.threadId,
          callId: active?.call.callId ?? callId,
          endpointId: callId,
        },
      };
      unwrap(
        await commands.begin.run(registry, {
          ...writer,
          input: {
            ...writer.input,
            ...(active === null
              ? {}
              : {
                  replacingCallId: active.call.callId,
                  ...(active.call.endpointId === undefined
                    ? {}
                    : { replacingEndpointId: active.call.endpointId }),
                }),
          },
        }),
      );
      return {
        callId: writer.input.callId,
        endpointId: writer.input.endpointId,
        append: async (entries) => {
          unwrap(
            await commands.append.run(registry, { ...writer, input: { ...writer.input, entries } }),
          );
        },
        end: async (reason, entries) => {
          unwrap(
            await commands.end.run(registry, {
              ...writer,
              input: { ...writer.input, reason, entries },
            }),
          );
        },
      };
    },
  });
  const connector: VoiceCallConnector = {
    async connect(call) {
      const tracker = createVoiceCallThreadTracker(call.callId);
      const detach = observe(call.target.threadRef, (state) => {
        if (call.signal.aborted) return;
        const event = tracker.observe(state);
        if (event !== null) call.onEvent(event);
      });
      call.signal.addEventListener("abort", detach, { once: true });
      try {
        const connected = await persisted.connect({
          ...call,
          onEvent: (event) => {
            if (event.type === "identity") tracker.setCallId(event.callId);
            call.onEvent(event);
          },
        });
        return {
          ...connected,
          close: async (reason) => {
            detach();
            call.signal.removeEventListener("abort", detach);
            await connected.close(reason);
          },
        };
      } catch (error) {
        detach();
        call.signal.removeEventListener("abort", detach);
        throw error;
      }
    },
  };
  return new VoiceCallController(connector, input.createCallId);
}

export function createVoiceCallThreadTracker(endpointId: string) {
  let hadLiveState = false;
  let currentCallId = endpointId;
  let hadOwnership = false;
  return {
    setCallId(callId: string) {
      currentCallId = callId;
    },
    observe(state: {
      status: EnvironmentThreadState["status"];
      data: Option.Option<Pick<OrchestrationV2ThreadProjection, "turnItems">>;
    }): VoiceCallEvent | null {
      // Synchronizing means shell events are waiting for their matching turn items,
      // including this call's own begin/append events. The connection is still live.
      if (
        state.status === "deleted" ||
        (hadLiveState && (state.status === "empty" || state.status === "cached"))
      ) {
        return { type: "failed", message: "Audio stopped because this conversation disconnected." };
      }
      if (state.status !== "live" || Option.isNone(state.data)) return null;
      hadLiveState = true;
      const item = state.data.value.turnItems.find(
        (item) => item.type === "voice_call" && item.call.callId === currentCallId,
      );
      if (item?.type !== "voice_call") return null;
      if (item.call.endpointId === endpointId) hadOwnership = true;
      else if (hadOwnership && item.call.endpointId !== undefined) {
        return { type: "ended", reason: "replaced" };
      }
      return item.call.endedAt !== null
        ? { type: "ended", reason: item.call.endReason ?? "interrupted" }
        : null;
    },
  };
}
