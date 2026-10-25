import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Admission test must not start a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const database = SqlitePersistence.layerMemory;
const settingsLayer = ServerSettings.layerTest();
const baseLayer = Layer.mergeAll(
  settingsLayer,
  ProjectStore.layer.pipe(Layer.provide(database)),
  ProjectionStore.layer.pipe(Layer.provide(database)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "bot-turn-defaults" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, settingsLayer, runEffectWorker: false },
  ),
);

const layer = ThreadManagement.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(baseLayer, CommandReceiptStore.layer.pipe(Layer.provide(database))),
  ),
);

it.effect(
  "bot requests snapshot defaults while queued and leave Code and existing work unchanged",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const settings = yield* ServerSettings.ServerSettingsService;
      const projects = yield* ProjectStore.ProjectStoreV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const now = "2026-10-24T00:00:00.000Z";
      const fallback = { instanceId, model: "gpt-5.1-codex" };
      for (const kind of ["bot", "code"] as const) {
        const projectId = ProjectId.make(kind);
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make(`project-${kind}`),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: kind,
            workspaceRoot: `/tmp/${kind}`,
            defaultModelSelection: null,
            ...(kind === "bot" ? { botRole: "specialist" as const } : {}),
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`create-${kind}`),
          threadId: ThreadId.make(kind),
          projectId,
          title: kind,
          modelSelection: fallback,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        });
      }
      const firstModel = {
        instanceId,
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "high" }],
      };
      yield* settings.updateSettings({
        botDefaults: { defaultModelSelection: firstModel, defaultRuntimeMode: "approval-required" },
      });
      const send = (kind: string, id: string) =>
        orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(id),
          threadId: ThreadId.make(kind),
          messageId: MessageId.make(id),
          text: "Do the task",
          attachments: [],
          modelSelection: fallback,
          createdBy: "agent",
          creationSource: "mcp",
          dispatchMode: { type: "queue_after_active" },
        });
      yield* send("bot", "first");
      yield* send("code", "code-first");
      const first = (yield* projections.getThreadRecords(ThreadId.make("bot"), ["runs"])).runs[0]!;
      assert.deepStrictEqual(first.modelSelection, firstModel);
      assert.strictEqual(first.runtimeMode, "approval-required");
      assert.strictEqual(
        (yield* projections.getThreadShell(ThreadId.make("bot")))?.runtimeMode,
        "approval-required",
      );
      const code = (yield* projections.getThreadRecords(ThreadId.make("code"), ["runs"])).runs[0]!;
      assert.deepStrictEqual(code.modelSelection, fallback);
      assert.isUndefined(code.runtimeMode);
      const secondModel = { instanceId, model: "gpt-6" };
      yield* settings.updateSettings({
        botDefaults: { defaultModelSelection: secondModel, defaultRuntimeMode: "full-access" },
      });
      const interruptedAt = yield* DateTime.now;
      yield* projections.apply({
        id: EventId.make("restart-cut"),
        type: "run.updated",
        threadId: ThreadId.make("bot"),
        runId: first.id,
        occurredAt: interruptedAt,
        payload: {
          ...first,
          status: "cancelled",
          startedAt: interruptedAt,
          completedAt: interruptedAt,
        },
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("restart-continuation"),
        threadId: ThreadId.make("bot"),
        messageId: MessageId.make("restart-continuation"),
        text: "Continue where you left off.",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
        restartContinuationOfRunId: first.id,
      });
      const continued = (yield* projections.getThreadRecords(ThreadId.make("bot"), [
        "runs",
      ])).runs.at(-1)!;
      assert.notStrictEqual(continued.id, first.id);
      assert.deepStrictEqual(continued.modelSelection, firstModel);
      assert.strictEqual(continued.runtimeMode, "approval-required");
      assert.strictEqual(
        (yield* projections.getShellSnapshot()).threads.find(
          (thread) => thread.id === ThreadId.make("bot"),
        )?.runtimeMode,
        "approval-required",
      );
      yield* send("bot", "second");
      const after = (yield* projections.getThreadRecords(ThreadId.make("bot"), ["runs"])).runs;
      assert.deepStrictEqual(after.find((run) => run.id === first.id)?.modelSelection, firstModel);
      assert.strictEqual(
        after.find((run) => run.id === first.id)?.runtimeMode,
        "approval-required",
      );
      const queued = after.find((run) => run.ordinal === 3)!;
      assert.deepStrictEqual(queued.modelSelection, secondModel);
      assert.strictEqual(queued.runtimeMode, "full-access");
      assert.strictEqual(queued.status, "queued");
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [ProjectId.make("bot")]: { defaultModelSelection: firstModel },
        },
      });
      yield* send("bot", "third");
      const final = (yield* projections.getThreadRecords(ThreadId.make("bot"), ["runs"])).runs;
      assert.deepStrictEqual(final.find((run) => run.ordinal === 4)?.modelSelection, firstModel);
      const threads = yield* ThreadManagement.ThreadManagementService;
      const peerRequest = {
        commandId: CommandId.make("peer-request"),
        messageId: MessageId.make("peer-request"),
        threadId: ThreadId.make("bot"),
        text: "Create the workout plan",
        context: {
          version: 1 as const,
          records: [
            {
              version: 1 as const,
              kind: "thread" as const,
              contextId: ComposerContextId.make("origin"),
              label: "Requesting bot",
              environmentId: EnvironmentId.make("other-machine"),
              threadId: ThreadId.make("origin-thread"),
              title: "Assistant",
            },
          ],
        },
      };
      const delivered = yield* threads.receivePeerMessage(peerRequest);
      const retried = yield* threads.receivePeerMessage(peerRequest);
      assert.deepStrictEqual(delivered, retried);
      assert.strictEqual(delivered.delivery, "queued");
      const received = yield* projections.getThreadRecords(peerRequest.threadId, [
        "runs",
        "messages",
      ]);
      assert.strictEqual(received.runs.length, 5);
      const message = received.messages.find(
        (candidate) => candidate.id === peerRequest.messageId,
      )!;
      assert.strictEqual(message.createdBy, "agent");
      assert.strictEqual(message.creationSource, "mcp");
      assert.deepStrictEqual(message.context, peerRequest.context);
      assert.deepStrictEqual(received.runs.at(-1)?.modelSelection, firstModel);
      yield* threads.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-after-peer"),
        threadId: peerRequest.threadId,
      });
      const replayAfterArchive = yield* threads.receivePeerMessage(peerRequest);
      assert.strictEqual(replayAfterArchive.runId, delivered.runId);
      assert.strictEqual(
        (yield* projections.getThreadRecords(peerRequest.threadId, ["runs"])).runs.length,
        5,
      );
    }).pipe(Effect.provide(layer)),
);
