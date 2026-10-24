import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  VoiceCallError,
  type VoiceCallConnectInput,
  type OrchestrationV2Run,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as TurnItemPositionStore from "../orchestration-v2/TurnItemPositionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VoiceApi from "./VoiceApi.ts";
import * as VoiceCalls from "./VoiceCalls.ts";
import * as VoiceConfiguration from "./VoiceConfiguration.ts";
import * as BotContext from "./BotContext.ts";
import * as BotWorkspace from "./BotWorkspace.ts";
import * as CodexVoice from "./CodexVoice.ts";
import * as VoiceSessions from "./VoiceSessions.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

const selection = { connectionId: "api", model: "gpt-live-1", voice: "marin" };
const projectId = ProjectId.make("bot-project");
const threadId = ThreadId.make("bot-thread");
const call = { threadId, callId: "call", owner: "desktop", endpointId: "tab" };
const request: VoiceCallConnectInput & { owner: string } = {
  ...call,
  transport: { type: "webrtc", sdp: "offer" },
};
const answer = {
  session: { id: "live-session" },
  transport: { type: "webrtc" as const, sdp: "answer" },
};

function layer(
  api: VoiceApi.VoiceApi["Service"],
  work: Effect.Effect<
    Partial<ThreadManagement.ThreadManagementService["Service"]>,
    never,
    ProjectionStore.ProjectionStoreV2 | EventSink.EventSinkV2
  > = Effect.succeed({}),
  watch?: FileSystem.FileSystem["watch"],
) {
  const platform =
    watch === undefined
      ? NodeServices.layer
      : Layer.effect(
          FileSystem.FileSystem,
          Effect.map(FileSystem.FileSystem, (fs) => ({ ...fs, watch })),
        ).pipe(Layer.provideMerge(NodeServices.layer));
  const storage = Layer.mergeAll(
    RuntimeLayer.layerEventSink,
    ProjectionStore.layer,
    ProjectStore.layer,
    TurnItemPositionStore.layer,
  ).pipe(Layer.provideMerge(SqlitePersistence.layerMemory), Layer.provideMerge(platform));
  const services = Layer.mergeAll(
    VoiceCalls.layer,
    BotContext.layer.pipe(Layer.provideMerge(BotWorkspace.layer)),
    VoiceConfiguration.layer,
  ).pipe(
    Layer.provideMerge(storage),
    Layer.provideMerge(
      ServerSettings.layerTest({
        voiceConnections: {
          api: { kind: "openai-api", name: "API", apiKey: "private-openai" },
          grok: { kind: "xai-api", name: "Grok", apiKey: "private-grok" },
          plan: {
            kind: "codex-subscription",
            name: "Plan",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
        },
        voiceSelection: selection,
      }),
    ),
  );
  return VoiceSessions.layer.pipe(
    Layer.provideMerge(services),
    Layer.provide(
      Layer.succeed(CodexVoice.CodexVoice, {
        connect: () => Effect.die("Unexpected subscription voice connection"),
      }),
    ),
    Layer.provide(Layer.succeed(VoiceApi.VoiceApi, api)),
    Layer.provide(
      Layer.unwrap(
        work.pipe(
          Effect.map((value) => Layer.mock(ThreadManagement.ThreadManagementService)(value)),
        ),
      ).pipe(Layer.provide(services)),
    ),
  );
}

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-voice-context-" });
  yield* fs.writeFileString(
    path.join(workspaceRoot, "AGENTS.md"),
    "The user's saved preference is comet-427. Keep it across calls.",
  );
  const now = yield* DateTime.now;
  const at = DateTime.formatIso(now);
  const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "chosen-harness" };
  yield* (yield* ProjectStore.ProjectStoreV2).apply({
    sequence: 1,
    eventId: EventId.make("project"),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: at,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId,
      title: "Fitness",
      botRole: "specialist",
      workspaceRoot,
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: at,
      updatedAt: at,
    },
  });
  yield* (yield* EventSink.EventSinkV2).write({
    events: [
      {
        id: EventId.make("thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          id: threadId,
          projectId,
          title: "Fitness",
          modelSelection,
          providerInstanceId: modelSelection.instanceId,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdBy: "user",
          creationSource: "web",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      },
    ],
  });
  const calls = yield* VoiceCalls.VoiceCalls;
  yield* calls.begin(call);
  return { calls, workspaceRoot, fs, path };
});

const unusedSecret = () => Effect.die("Unexpected Grok request");

it.effect(
  "updates active-call memory after atomic replacement and releases its watcher on hangup",
  () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
      const initial = yield* Deferred.make<string>();
      const corrected = yield* Deferred.make<string>();
      const released = yield* Deferred.make<void>();
      let watchedPath: string | undefined;
      yield* Effect.gen(function* () {
        const { fs, path, workspaceRoot, calls } = yield* fixture;
        const sessions = yield* VoiceSessions.VoiceSessions;
        const observer = yield* sessions.observeContext(call).pipe(
          Stream.runForEach((instructions) =>
            Deferred.succeed(
              instructions.includes("orbit-918") ? corrected : initial,
              instructions,
            ),
          ),
          Effect.forkChild,
        );
        assert.include(yield* Deferred.await(initial), "comet-427");
        assert.equal(watchedPath, workspaceRoot);
        const replacement = path.join(workspaceRoot, "new-memory.md");
        yield* fs.writeFileString(replacement, "The corrected preference is orbit-918.");
        yield* fs.rename(replacement, path.join(workspaceRoot, "AGENTS.md"));
        yield* Queue.offer(events, { _tag: "Create", path: "AGENTS.md" });
        yield* TestClock.adjust("150 millis");
        const next = yield* Deferred.await(corrected);
        assert.notInclude(next, "comet-427");
        yield* calls.end({ ...call, reason: "user" });
        assert.equal((yield* sessions.readContext(call).pipe(Effect.flip)).reason, "ended");
        yield* Fiber.interrupt(observer);
        yield* Deferred.await(released);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layer(
            {
              openLive: () => Effect.die("Unexpected voice negotiation"),
              grokClientSecret: unusedSecret,
            },
            Effect.succeed({}),
            (directory) => {
              watchedPath = directory;
              return Stream.fromQueue(events).pipe(
                Stream.ensuring(Deferred.succeed(released, undefined)),
              );
            },
          ),
        ),
      );
    }),
);

it.effect(
  "gives every topic a bounded directory including its archived main and other topics",
  () =>
    Effect.gen(function* () {
      yield* fixture;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const sink = yield* EventSink.EventSinkV2;
      const sql = yield* SqlClient.SqlClient;
      const original = yield* projections.getThread(threadId);
      const now = yield* DateTime.now;
      yield* sql`UPDATE projection_projects SET bot_main_thread_id = ${threadId}
      WHERE project_id = ${projectId}`;
      for (let i = 0; i < 20; i++) {
        const id = ThreadId.make(`topic-${String(i).padStart(2, "0")}`);
        yield* sink.write({
          events: [
            {
              id: EventId.make(`create-${id}`),
              type: "thread.created",
              threadId: id,
              occurredAt: now,
              payload: {
                ...original,
                id,
                title: `Topic ${i}`,
                archivedAt: i === 19 ? now : null,
                lineage: { parentThreadId: null, rootThreadId: id, relationshipToParent: null },
              },
            },
          ],
        });
      }
      for (const [id, owner, deletedAt, title] of [
        ["foreign", ProjectId.make("another-bot"), null, "FOREIGN_BOT_TOPIC"],
        ["deleted", projectId, now, "DELETED_TOPIC"],
        ["worker", projectId, null, "SUBAGENT_TASK"],
      ] as const) {
        yield* sink.write({
          events: [
            {
              id: EventId.make(`create-${id}`),
              type: "thread.created",
              threadId: ThreadId.make(id),
              occurredAt: now,
              payload: {
                ...original,
                id: ThreadId.make(id),
                projectId: owner,
                title,
                deletedAt,
                lineage: {
                  parentThreadId: id === "worker" ? threadId : null,
                  rootThreadId: id === "worker" ? threadId : ThreadId.make(id),
                  relationshipToParent: id === "worker" ? "subagent" : null,
                },
              },
            },
          ],
        });
      }
      yield* sink.write({
        events: [
          {
            id: EventId.make("archive-main"),
            type: "thread.archived",
            threadId,
            occurredAt: now,
            payload: { ...original, archivedAt: now },
          },
        ],
      });
      const context = yield* BotContext.BotContext;
      for (const value of [
        yield* context.readForWork(ThreadId.make("topic-18"), null),
        JSON.stringify(yield* context.read(ThreadId.make("topic-18"))),
      ]) {
        assert.include(value, "bot-thread");
        assert.include(value, "topic-19");
        assert.include(value, "archive");
        assert.include(value, "t3_thread_read");
        assert.include(value, "nextCursor");
        assert.notInclude(value, "topic-00");
        assert.notInclude(value, "FOREIGN_BOT_TOPIC");
        assert.notInclude(value, "DELETED_TOPIC");
        assert.notInclude(value, "SUBAGENT_TASK");
      }
      const work = yield* context.readForWork(ThreadId.make("topic-18"), null);
      assert.include(work, '"main":true');
      assert.include(work, '"archived":true');
      assert.include(work, '"current":true');
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer({ openLive: () => Effect.succeed(answer), grokClientSecret: unusedSecret }),
      ),
    ),
);

it.effect(
  "negotiates from the bot's saved selection and own durable text without changing its harness",
  () => {
    const requests: Array<Parameters<VoiceApi.VoiceApi["Service"]["openLive"]>[0]> = [];
    return Effect.gen(function* () {
      const { calls } = yield* fixture;
      yield* calls.append({
        ...call,
        entries: [
          {
            id: "one",
            ordinal: 0,
            revision: 0,
            final: true,
            speaker: "user",
            text: "Continue my workout tomorrow.",
          },
        ],
      });
      const sessions = yield* VoiceSessions.VoiceSessions;
      assert.deepEqual(yield* sessions.connect(request), {
        kind: "openai-live",
        sessionId: "live-session",
        sdp: "answer",
      });
      assert.equal(requests.length, 1);
      assert.equal(Redacted.value(requests[0]!.apiKey), "private-openai");
      assert.equal(requests[0]!.voice, "marin");
      assert.include(requests[0]!.instructions, "comet-427");
      assert.isTrue(
        requests[0]!.history.some(
          (row) => row.role === "user" && row.text === "Continue my workout tomorrow.",
        ),
      );
      assert.equal(
        (yield* (yield* ProjectionStore.ProjectionStoreV2).getThread(threadId)).modelSelection
          .model,
        "chosen-harness",
      );
      assert.equal(
        (yield* sessions.connect(request).pipe(Effect.flip)).reason,
        "already-attempted",
      );
      assert.equal(requests.length, 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer({
          openLive: (input) =>
            Effect.sync(() => {
              requests.push(input);
              return answer;
            }),
          grokClientSecret: unusedSecret,
        }),
      ),
    );
  },
);

it.effect(
  "rejects the wrong owner, an ended call, and a mismatched transport before contacting a provider",
  () => {
    let contacted = 0;
    return Effect.gen(function* () {
      const { calls } = yield* fixture;
      const sessions = yield* VoiceSessions.VoiceSessions;
      assert.equal(
        (yield* sessions.connect({ ...request, owner: "phone" }).pipe(Effect.flip)).reason,
        "owner-changed",
      );
      assert.equal(
        (yield* sessions
          .connect({ ...request, transport: { type: "websocket" } })
          .pipe(Effect.flip)).reason,
        "transport-mismatch",
      );
      yield* calls.end({ ...call, reason: "user" });
      assert.equal((yield* sessions.connect(request).pipe(Effect.flip)).reason, "ended");
      assert.equal(contacted, 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer({
          openLive: () =>
            Effect.sync(() => {
              contacted++;
              return answer;
            }),
          grokClientSecret: unusedSecret,
        }),
      ),
    );
  },
);

it.effect("does not return a negotiated session after another device takes over", () =>
  Effect.gen(function* () {
    const contacted = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      const { calls } = yield* fixture;
      const sessions = yield* VoiceSessions.VoiceSessions;
      const pending = yield* sessions.connect(request).pipe(Effect.forkChild);
      yield* Deferred.await(contacted);
      yield* calls.begin({
        threadId,
        callId: "phone-call",
        owner: "phone",
        replacingCallId: call.callId,
      });
      yield* Deferred.succeed(release, undefined);
      const error = yield* Fiber.join(pending).pipe(Effect.flip);
      assert.instanceOf(error, VoiceCallError);
      assert.equal(error.reason, "ended");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer({
          openLive: () =>
            Deferred.succeed(contacted, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(answer),
            ),
          grokClientSecret: unusedSecret,
        }),
      ),
    );
  }),
);

it.effect("uses a bot override for Grok and returns only a short-lived credential", () => {
  const keys: string[] = [];
  return Effect.gen(function* () {
    yield* fixture;
    yield* (yield* ServerSettings.ServerSettingsService).updateSettings({
      projectSettingsOverrides: {
        [projectId]: {
          voiceSelection: { connectionId: "grok", model: "grok-voice-3.0", voice: "eve" },
        },
      },
    });
    const result = yield* (yield* VoiceSessions.VoiceSessions).connect({
      ...request,
      transport: { type: "websocket" },
    });
    assert.equal(result.kind, "grok");
    if (result.kind !== "grok") throw new Error("Expected Grok");
    assert.equal(result.clientSecret, "ephemeral");
    assert.equal(result.voice, "eve");
    assert.equal(result.expiresAt, 1_800_000_000);
    assert.deepEqual(keys, ["private-grok"]);
    assert.notInclude(JSON.stringify(result), "private-grok");
  }).pipe(
    Effect.scoped,
    Effect.provide(
      layer({
        openLive: () => Effect.die("Unexpected OpenAI request"),
        grokClientSecret: (key) =>
          Effect.sync(() => {
            keys.push(Redacted.value(key));
            return { value: "ephemeral", expires_at: 1_800_000_000 };
          }),
      }),
    ),
  );
});

it.effect(
  "does not fall back when a bot disables voice or selects an unusable account or model",
  () =>
    Effect.gen(function* () {
      yield* fixture;
      const settings = yield* ServerSettings.ServerSettingsService;
      const sessions = yield* VoiceSessions.VoiceSessions;
      for (const selected of [
        null,
        { ...selection, connectionId: "removed" },
        { ...selection, connectionId: "plan" },
        { ...selection, voice: "invented" },
      ]) {
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { voiceSelection: selected } },
        });
        const error = yield* sessions.connect(request).pipe(Effect.flip);
        assert.equal(error.reason, selected === null ? "not-configured" : "unavailable");
      }
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer({
          openLive: () => Effect.die("Unexpected provider request"),
          grokClientSecret: unusedSecret,
        }),
      ),
    ),
);

it.effect("bounds startup text, preserves ordinal ordering, and excludes another thread", () =>
  Effect.gen(function* () {
    const { calls, fs, path, workspaceRoot } = yield* fixture;
    yield* fs.writeFileString(path.join(workspaceRoot, "AGENTS.md"), "a".repeat(20_000));
    for (let offset = 0; offset < 150; offset += 30) {
      yield* calls.append({
        ...call,
        entries: Array.from({ length: 30 }, (_, i) => ({
          id: `row-${i + offset}`,
          ordinal: i + offset,
          revision: 0,
          final: true,
          speaker: "user" as const,
          text: `Line ${i + offset}`,
        })),
      });
    }
    const now = yield* DateTime.now;
    yield* (yield* EventSink.EventSinkV2).write({
      events: [
        {
          id: EventId.make("other-message-event"),
          type: "message.updated",
          threadId: ThreadId.make("other-thread"),
          occurredAt: now,
          payload: {
            id: MessageId.make("other-message"),
            threadId: ThreadId.make("other-thread"),
            runId: null,
            nodeId: null,
            role: "user",
            text: "OTHER BOT SECRET",
            createdBy: "user",
            creationSource: "web",
            attachments: [],
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    });
    const context = yield* (yield* BotContext.BotContext).read(threadId);
    // Saved instructions (8 KiB), conversation directory (4 KiB), and fixed voice guidance.
    assert.isBelow(Buffer.byteLength(context.instructions), 16_384);
    assert.include(context.instructions, "More bot instructions");
    assert.isAtMost(context.history.length, 128);
    assert.isBelow(Buffer.byteLength(JSON.stringify(context.history)), 8192);
    assert.notInclude(JSON.stringify(context), "OTHER BOT SECRET");
    const ordinals = context.history
      .filter((row) => row.role === "user")
      .map((row) => Number(row.text.replace("Line ", "")));
    assert.deepEqual(
      ordinals,
      ordinals.toSorted((a, b) => a - b),
    );
    assert.equal(ordinals.at(-1), 149);
    assert.notInclude(ordinals, 0);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      layer({ openLive: () => Effect.succeed(answer), grokClientSecret: unusedSecret }),
    ),
  ),
);

it.effect("keeps large history references and multilingual text within the startup budget", () =>
  Effect.gen(function* () {
    yield* fixture;
    const now = yield* DateTime.now;
    yield* (yield* EventSink.EventSinkV2).write({
      events: Array.from({ length: 120 }, (_, i) => ({
        id: EventId.make(`history-event-${i}`),
        type: "message.updated" as const,
        threadId,
        occurredAt: now,
        payload: {
          id: MessageId.make(`history-${i}`),
          threadId,
          runId: null,
          nodeId: null,
          role: "user" as const,
          text: `${i}: ${"会話🙂".repeat(200)}`,
          createdBy: "user" as const,
          creationSource: "provider" as const,
          attachments: [],
          streaming: false,
          createdAt: now,
          updatedAt: now,
          voiceCall: {
            callId: `${i}`.padEnd(128, "x"),
            entryId: "entry",
            ordinal: i,
            revision: 0,
            final: true,
          },
        },
      })),
    });
    const context = yield* (yield* BotContext.BotContext).read(threadId);
    assert.isBelow(Buffer.byteLength(JSON.stringify(context.history)), 8192);
    assert.isAtMost(context.history.length, 128);
    assert.isTrue(context.history.some((message) => message.role === "user"));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      layer({ openLive: () => Effect.succeed(answer), grokClientSecret: unusedSecret }),
    ),
  ),
);

it.effect(
  "voice work reuses the chosen harness and durable request across retries and hangup",
  () =>
    Effect.gen(function* () {
      const dispatched: ThreadManagement.ThreadManagementSendInput[] = [];
      const work = Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const sink = yield* EventSink.EventSinkV2;
        const sendToThread: ThreadManagement.ThreadManagementService["Service"]["sendToThread"] =
          Effect.fn("VoiceWorkTest.send")(function* (input) {
            dispatched.push(input);
            const thread = yield* projections.getThread(input.threadId);
            const now = yield* DateTime.now;
            const run: OrchestrationV2Run = {
              id: RunId.make(`run-${dispatched.length}`),
              threadId: input.threadId,
              ordinal: dispatched.length,
              providerInstanceId: thread.providerInstanceId,
              modelSelection: thread.modelSelection,
              providerThreadId: null,
              userMessageId: input.messageId,
              rootNodeId: null,
              activeAttemptId: null,
              status: "queued",
              requestedAt: now,
              startedAt: null,
              completedAt: null,
              checkpointId: null,
              contextHandoffId: null,
            };
            const message: OrchestrationV2ConversationMessage = {
              id: input.messageId,
              threadId: input.threadId,
              runId: run.id,
              nodeId: null,
              role: "user",
              text: input.text,
              createdBy: input.createdBy,
              creationSource: input.creationSource,
              attachments: [],
              streaming: false,
              createdAt: now,
              updatedAt: now,
            };
            yield* sink.write({
              events: [
                {
                  id: EventId.make(`${run.id}-message`),
                  type: "message.updated",
                  threadId: thread.id,
                  occurredAt: now,
                  payload: message,
                },
                {
                  id: EventId.make(`${run.id}-run`),
                  type: "run.updated",
                  threadId: thread.id,
                  occurredAt: now,
                  payload: run,
                },
              ],
            });
            return {
              dispatch: { sequence: 1, storedEvents: [] },
              message,
              run,
              turnItem: null,
              delivery: "queued" as const,
              projection: { thread, runs: [run], messages: [message], turnItems: [] },
            };
          }, Effect.orDie);
        return { sendToThread };
      });
      // The mock models the existing thread queue's commit boundary, never starts an actual agent.
      const workLayer = layer(
        {
          openLive: () => Effect.die("Unexpected voice request"),
          grokClientSecret: () => Effect.die("Unexpected voice request"),
        },
        work,
      );
      yield* Effect.gen(function* () {
        yield* fixture;
        const sessions = yield* VoiceSessions.VoiceSessions;
        const calls = yield* VoiceCalls.VoiceCalls;
        const input = {
          ...call,
          requestId: "delegation/one",
          text: "Investigate the selected login button",
          viewContext: "This phone: browser tab test-page, button Login",
        };
        const results = yield* Effect.all([sessions.startWork(input), sessions.startWork(input)], {
          concurrency: "unbounded",
        });
        assert.deepEqual(results[0], results[1]);
        assert.equal(dispatched.length, 1);
        assert.equal(dispatched[0]!.threadId, threadId);
        assert.equal(dispatched[0]!.mode, "queue");
        assert.notProperty(dispatched[0]!, "modelSelection");
        assert.include(dispatched[0]!.text, "This phone: browser tab");
        assert.include(dispatched[0]!.text, input.text);
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const records = yield* projections.getThreadRecords(threadId, ["runs"], {
          runIds: [results[0]!.runId],
        });
        assert.equal(records.runs[0]?.modelSelection.model, "chosen-harness");
        yield* calls.append({
          ...call,
          entries: [
            {
              id: "new-speech",
              ordinal: 0,
              revision: 0,
              final: true,
              speaker: "user",
              text: "More context arrived",
            },
          ],
        });
        assert.deepEqual(yield* sessions.startWork(input), results[0]);
        assert.equal(dispatched.length, 1);
        assert.deepInclude(
          yield* Effect.flip(sessions.startWork({ ...input, owner: "stranger" })),
          { _tag: "VoiceCallError", reason: "owner-changed" },
        );
        const phone = { ...call, owner: "phone", endpointId: "phone-tab" };
        yield* calls.begin({
          ...phone,
          replacingCallId: call.callId,
          replacingEndpointId: call.endpointId,
        });
        const transferred = yield* sessions.startWork({ ...input, ...phone });
        assert.notEqual(transferred.runId, results[0]!.runId);
        assert.notEqual(transferred.messageId, results[0]!.messageId);
        assert.deepEqual(yield* sessions.startWork({ ...input, ...phone }), transferred);
        assert.equal(dispatched.length, 2);
        yield* calls.end({ ...phone, reason: "user" });
        assert.deepInclude(
          yield* Effect.flip(sessions.startWork({ ...input, ...phone, requestId: "late" })),
          { _tag: "VoiceCallError", reason: "ended" },
        );
        const after = yield* projections.getThreadRecords(threadId, ["runs"], {
          runIds: [results[0]!.runId],
        });
        assert.equal(after.runs[0]?.status, "queued");
        assert.equal(dispatched.length, 2);
      }).pipe(Effect.provide(workLayer));
    }),
);

it.effect("delivers saved memory and the same conversation brief to voice and work sessions", () =>
  Effect.gen(function* () {
    const { fs, path, workspaceRoot } = yield* fixture;
    const workspace = yield* BotWorkspace.BotWorkspace;
    const brief = yield* workspace.conversation(workspaceRoot, threadId);
    yield* fs.makeDirectory(path.join(workspaceRoot, "conversations"));
    yield* fs.writeFileString(
      path.join(workspaceRoot, brief.file),
      "The CSV was already imported. Next: inspect the September gap. Result: fitness.sqlite.",
    );
    const context = yield* BotContext.BotContext;
    const voice = yield* context.read(threadId);
    const work = yield* context.readForWork(threadId, null);
    assert.include(voice.instructions, "comet-427");
    assert.include(work, "comet-427");
    assert.include(JSON.stringify(voice.history), "CSV was already imported");
    assert.include(work, "CSV was already imported");
    assert.include(work, brief.file);
    yield* fs.writeFileString(
      path.join(workspaceRoot, "AGENTS.md"),
      "The corrected preference is orbit-918.",
    );
    assert.include((yield* context.read(threadId)).instructions, "orbit-918");
    assert.notInclude(yield* context.readForWork(threadId, null), "comet-427");
    yield* fs.remove(path.join(workspaceRoot, brief.file));
    assert.notInclude(
      JSON.stringify((yield* context.read(threadId)).history),
      "CSV was already imported",
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      layer({ openLive: () => Effect.succeed(answer), grokClientSecret: unusedSecret }),
    ),
  ),
);

it.effect(
  "delivers late transcript corrections after the previous work prompt, without replaying unchanged lines",
  () =>
    Effect.gen(function* () {
      const { calls } = yield* fixture;
      const old = {
        id: "spoken",
        ordinal: 0,
        revision: 0,
        final: false,
        speaker: "user" as const,
        text: "Goal 190",
      };
      yield* calls.append({ ...call, entries: [old] });
      yield* TestClock.adjust("1 second");
      const previousPromptAt = yield* DateTime.now;
      const context = yield* BotContext.BotContext;
      assert.notInclude(yield* context.readForWork(threadId, previousPromptAt), "Goal 190");
      yield* TestClock.adjust("1 second");
      yield* calls.end({
        ...call,
        reason: "user",
        entries: [{ ...old, revision: 1, final: true, text: "Correction: goal 180" }],
      });
      const work = yield* context.readForWork(threadId, previousPromptAt);
      assert.include(work, "Correction: goal 180");
      assert.include(work, "do not repeat completed actions");
      assert.notInclude(work, "Goal 190");
      const history = yield* (yield* ProjectionStore.ProjectionStoreV2).getTurnStartHistory(
        threadId,
      );
      assert.equal(history[0]?.type, "voice_call");
      assert.deepEqual(
        yield* (yield* ProjectionStore.ProjectionStoreV2).getTurnStartHistory(threadId, []),
        [],
      );
      const sql = yield* SqlClient.SqlClient;
      const plan = yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
      SELECT message_id FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} AND json_extract(payload_json, '$.voiceCall') IS NOT NULL
        AND updated_at >= ${DateTime.formatIso(previousPromptAt)}
      ORDER BY updated_at DESC, message_id DESC LIMIT 120`;
      assert.isTrue(plan.some((row) => row.detail.includes("voice_transcript_updated_idx")));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer({ openLive: () => Effect.succeed(answer), grokClientSecret: unusedSecret }),
      ),
    ),
);

it.effect("shares bot memory without mixing topic briefs or voice conversations", () =>
  Effect.gen(function* () {
    const { calls, fs, path, workspaceRoot } = yield* fixture;
    const workspace = yield* BotWorkspace.BotWorkspace;
    const ownBrief = yield* workspace.conversation(workspaceRoot, threadId);
    yield* fs.makeDirectory(path.join(workspaceRoot, "conversations"));
    yield* fs.writeFileString(path.join(workspaceRoot, ownBrief.file), "MAIN_TOPIC_DECISION");
    yield* calls.end({
      ...call,
      reason: "user",
      entries: [
        {
          id: "main",
          ordinal: 0,
          revision: 0,
          final: true,
          speaker: "user",
          text: "MAIN_TOPIC_SPEECH",
        },
      ],
    });
    const otherId = ThreadId.make("another-topic");
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const original = yield* projections.getThread(threadId);
    const now = yield* DateTime.now;
    yield* (yield* EventSink.EventSinkV2).write({
      events: [
        {
          id: EventId.make("another-topic-created"),
          type: "thread.created",
          threadId: otherId,
          occurredAt: now,
          payload: {
            ...original,
            id: otherId,
            title: "A different topic",
            lineage: { parentThreadId: null, rootThreadId: otherId, relationshipToParent: null },
          },
        },
      ],
    });
    const otherCall = { ...call, threadId: otherId, callId: "other-call" };
    yield* calls.begin(otherCall);
    yield* calls.end({
      ...otherCall,
      reason: "user",
      entries: [
        {
          id: "other",
          ordinal: 0,
          revision: 0,
          final: true,
          speaker: "user",
          text: "OTHER_TOPIC_SPEECH",
        },
      ],
    });
    const context = yield* BotContext.BotContext;
    const main = yield* context.readForWork(threadId, null);
    const other = yield* context.readForWork(otherId, null);
    assert.include(main, "MAIN_TOPIC_DECISION");
    assert.include(main, "MAIN_TOPIC_SPEECH");
    assert.notInclude(main, "OTHER_TOPIC_SPEECH");
    assert.include(other, "comet-427");
    assert.include(other, "OTHER_TOPIC_SPEECH");
    assert.notInclude(other, "MAIN_TOPIC");
    assert.notInclude(JSON.stringify(yield* context.read(otherId)), "MAIN_TOPIC");
  }).pipe(
    Effect.scoped,
    Effect.provide(
      layer({ openLive: () => Effect.succeed(answer), grokClientSecret: unusedSecret }),
    ),
  ),
);
