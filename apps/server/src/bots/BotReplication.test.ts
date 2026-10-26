import { botVoiceSelection, botComplexTaskModel } from "@t3tools/shared/botPreferences";
import { derive } from "@t3tools/provider-core/server/IdAllocator";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { ProviderDriverKind } from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  BotId,
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as Identity from "../environment/ServerEnvironment.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Runtime from "../orchestration-v2/runtimeLayer.ts";
import * as Sink from "../orchestration-v2/EventSink.ts";
import * as Projection from "../orchestration-v2/ProjectionStore.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Enrichment from "../project/ProjectEnrichmentService.ts";
import * as Favicon from "../project/ProjectFaviconResolver.ts";
import * as Repository from "../project/RepositoryIdentityResolver.ts";
import * as Paths from "../workspace/WorkspacePaths.ts";
import * as Replication from "./BotReplication.ts";
import * as Files from "./BotContinuityFiles.ts";

const adapter = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("This test admits work but never starts a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const testSettings = Settings.layerTest();
const fixture = (name: string, provider = adapter) =>
  Layer.fresh(
    Layer.mergeAll(
      ProviderReplayHarness.layerWithRegistry(
        { name },
        ProviderAdapterRegistry.layerFromAdapters([provider]),
        { databaseLayer: Sqlite.layerMemory, settingsLayer: testSettings, runEffectWorker: false },
      ),
      Runtime.layerBotReplication,
      Runtime.layerProjectService,
      Runtime.layerEventSink,
      Projection.layer,
    ).pipe(
      Layer.provideMerge(Enrichment.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.mock(Git.GitVcsDriver)({}),
          Layer.mock(GitWorkflow.GitWorkflowService)({ isRepository: () => Effect.succeed(false) }),
          Layer.succeed(Repository.RepositoryIdentityResolver, {
            resolve: () => Effect.succeed(null),
          }),
          Layer.succeed(Favicon.ProjectFaviconResolver, {
            invalidate: () => Effect.void,
            resolvePath: () => Effect.succeed(null),
          }),
          Layer.mock(Paths.WorkspacePaths)({ normalizeWorkspaceRoot: Effect.succeed }),
          Layer.succeed(Identity.ServerEnvironmentIdentity, {
            getEnvironmentId: Effect.succeed(EnvironmentId.make(name)),
          }),
        ),
      ),
      Layer.provideMerge(Sqlite.layerMemory),
      Layer.provideMerge(testSettings),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: `t3-replica-${name}-` })),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
const projectId = ProjectId.make("fitness");
const threadId = ThreadId.make("fitness-main");
const now = DateTime.makeUnsafe("2026-10-25T12:00:00.000Z");
const sourceThread: OrchestrationV2AppThread = {
  id: threadId,
  projectId,
  title: "Main",
  createdBy: "user",
  creationSource: "web",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledAt: null,
  settledOverride: null,
  lastVisitedAt: null,
  deletedAt: null,
};

it.effect(
  "copies history and memory, never native work or ZIPs, and reconciles after recovery",
  () =>
    Effect.gen(function* () {
      const a = yield* Layer.build(fixture("jakebook"));
      const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
      const didStart = yield* Deferred.make<void>();
      const provider: ProviderAdapter.ProviderAdapterV2["Service"] = {
        ...adapter,
        openSession: (input) =>
          Effect.gen(function* () {
            const timestamp = yield* DateTime.now;
            return {
              instanceId: adapter.instanceId,
              driver: adapter.driver,
              providerSessionId: input.providerSessionId,
              providerSession: {
                id: input.providerSessionId,
                driver: adapter.driver,
                providerInstanceId: adapter.instanceId,
                status: "ready",
                cwd: process.cwd(),
                model: "gpt-5.4",
                capabilities: CodexProviderCapabilitiesV2,
                createdAt: timestamp,
                updatedAt: timestamp,
                lastError: null,
              },
              events: Stream.never,
              ensureThread: ({ threadId }) =>
                Effect.succeed({
                  id: ProviderThreadId.make(`replica-native:${threadId}`),
                  driver: adapter.driver,
                  providerInstanceId: adapter.instanceId,
                  providerSessionId: input.providerSessionId,
                  appThreadId: threadId,
                  ownerNodeId: null,
                  nativeThreadRef: {
                    driver: adapter.driver,
                    nativeId: "fresh-native-thread",
                    strength: "strong",
                  },
                  nativeConversationHeadRef: null,
                  status: "idle",
                  firstRunOrdinal: null,
                  lastRunOrdinal: null,
                  handoffIds: [],
                  forkedFrom: null,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                }),
              resumeThread: () => Effect.die("A replica must start a fresh native session"),
              startTurn: (turn) =>
                Effect.sync(() => {
                  started.push(turn);
                }).pipe(Effect.andThen(Deferred.succeed(didStart, undefined)), Effect.asVoid),
              steerTurn: () => Effect.die("unused"),
              interruptTurn: () => Effect.void,
              respondToRuntimeRequest: () => Effect.die("unused"),
              readThreadSnapshot: () => Effect.die("unused"),
              rollbackThread: () => Effect.die("unused"),
              forkThread: () => Effect.die("unused"),
            };
          }),
      };
      const b = yield* Layer.build(fixture("r2d2", provider));
      const first = Context.get(a, Replication.BotReplication);
      const second = Context.get(b, Replication.BotReplication);
      const fs = Context.get(a, FileSystem.FileSystem);
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "replica-source-" });
      yield* fs.writeFileString(`${root}/AGENTS.md`, "Remember: three days per week.");
      yield* fs.writeFileString(`${root}/upload.zip`, "large original-only file");
      yield* Context.get(a, Projects.ProjectService).create({
        commandId: CommandId.make("create"),
        projectId,
        title: "Fitness",
        workspaceRoot: root,
        botRole: "specialist",
      });
      yield* Context.get(a, Projects.ProjectService).update({
        commandId: CommandId.make("main"),
        projectId,
        botMainThreadId: threadId,
        projectIcon: { kind: "monogram", text: "F", color: "green" },
      });
      const sink = Context.get(a, Sink.EventSinkV2);
      yield* sink.write({
        events: [
          {
            id: EventId.make("create-thread"),
            type: "thread.created",
            threadId,
            occurredAt: now,
            payload: sourceThread,
          },
        ],
      });
      for (let i = 0; i < 70; i++)
        yield* sink.write({
          events: [
            {
              id: EventId.make(`message-${i}`),
              type: "message.updated",
              threadId,
              occurredAt: now,
              payload: {
                id: MessageId.make(`message-${i}`),
                threadId,
                role: "user",
                text: `Request ${i}`,
                runId: null,
                nodeId: null,
                streaming: false,
                attachments: [],
                createdAt: now,
                updatedAt: now,
                createdBy: "user",
                creationSource: "web",
              },
            },
          ],
        });
      const page1 = yield* first.read({ projectId, includeManifest: true });
      assert.isFalse(page1.complete);
      assert.lengthOf(page1.messages, 64);
      yield* second.receive(page1);
      assert.isFalse((yield* second.status).projects[0]!.ready);
      const dispatch = (commandId: string) =>
        Context.get(b, Orchestrator.OrchestratorV2).dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(commandId),
          threadId,
          messageId: MessageId.make(commandId),
          text: "What was the latest plan?",
          attachments: [],
          createdBy: "user",
          creationSource: "mobile",
          dispatchMode: { type: "start_immediately" },
        });
      assert.equal((yield* Effect.exit(dispatch("premature")))._tag, "Failure");
      const gap = yield* Effect.exit(second.receive({ ...page1, after: { sequence: 999999 } }));
      assert.equal(gap._tag, "Failure");
      const page2 = yield* first.read({ projectId, includeManifest: false, after: page1.cursor! });
      yield* second.receive(page2);
      yield* second.receive(page2);
      yield* second.receive(page1);
      assert.equal((yield* second.status).cursors[0]!.cursor!.sequence, page2.cursor!.sequence);
      assert.isTrue((yield* second.status).projects[0]!.ready);
      const sql = Context.get(b, SqlClient.SqlClient);
      assert.equal(
        (yield* sql<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM orchestration_v2_projection_messages`)[0]!.count,
        70,
      );
      assert.equal(
        (yield* sql<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM orchestration_v2_projection_runs`)[0]!.count,
        0,
      );
      const thread = yield* Context.get(b, Projection.ProjectionStoreV2).getThread(threadId);
      assert.equal(thread.historyOrigin, "bot_replica");
      assert.equal(thread.replicaEnvironmentId, "r2d2");
      assert.isNull(thread.activeProviderThreadId);
      const copy = yield* Context.get(b, Projects.ProjectService).getById(projectId);
      assert.equal(copy._tag, "Some");
      if (copy._tag !== "Some") return;
      assert.deepEqual(copy.value.projectIcon, { kind: "monogram", text: "F", color: "green" });
      assert.equal(
        yield* fs.readFileString(`${copy.value.workspaceRoot}/AGENTS.md`),
        "Remember: three days per week.",
      );
      assert.isFalse(yield* fs.exists(`${copy.value.workspaceRoot}/upload.zip`));
      yield* Context.get(b, Sink.EventSinkV2).write({
        events: [
          {
            id: EventId.make("survivor-message"),
            type: "message.updated",
            threadId,
            occurredAt: now,
            payload: {
              id: MessageId.make("survivor-message"),
              threadId,
              role: "assistant",
              text: "Updated the plan.",
              runId: null,
              nodeId: null,
              streaming: false,
              attachments: [],
              createdAt: now,
              updatedAt: now,
              createdBy: "agent",
              creationSource: "server",
            },
          },
        ],
      });
      let reverse = yield* second.read({ projectId, includeManifest: true });
      yield* first.receive(reverse);
      while (!reverse.complete) {
        reverse = yield* second.read({ projectId, includeManifest: false, after: reverse.cursor! });
        yield* first.receive(reverse);
      }
      const back = Context.get(a, SqlClient.SqlClient);
      assert.equal(
        (yield* back<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM orchestration_v2_projection_messages`)[0]!.count,
        71,
      );
      const correctedAt = DateTime.makeUnsafe("2026-10-25T12:01:00.000Z");
      const corrected = (yield* Context.get(a, Projection.ProjectionStoreV2).getThreadRecords(
        threadId,
        ["messages"],
      )).messages.find((message) => message.id === "message-69")!;
      yield* sink.write({
        events: [
          {
            id: EventId.make("correct-message"),
            type: "message.updated",
            threadId,
            occurredAt: correctedAt,
            payload: { ...corrected, text: "Corrected latest plan", updatedAt: correctedAt },
          },
          {
            id: EventId.make("rename-thread"),
            type: "thread.metadata-updated",
            threadId,
            occurredAt: correctedAt,
            payload: { ...sourceThread, title: "Training", updatedAt: correctedAt },
          },
        ],
      });
      const correctedPage = yield* first.read({
        projectId,
        includeManifest: true,
        after: page2.cursor!,
      });
      yield* second.receive(correctedPage);
      yield* second.receive(page1);
      const correctedCopy = yield* Context.get(b, Projection.ProjectionStoreV2).getThreadRecords(
        threadId,
        ["messages"],
      );
      assert.equal(
        correctedCopy.messages.find((message) => message.id === "message-69")?.text,
        "Corrected latest plan",
      );
      assert.equal(
        (yield* Context.get(b, Projection.ProjectionStoreV2).getThread(threadId)).title,
        "Training",
      );
      yield* dispatch("fresh-request");
      const runs = (yield* Context.get(b, Projection.ProjectionStoreV2).getThreadRecords(threadId, [
        "runs",
      ])).runs;
      assert.lengthOf(runs, 1);
      assert.equal(runs[0]!.userMessageId, "fresh-request");
      assert.notEqual(runs[0]!.id, derive.run({ threadId, ordinal: runs[0]!.ordinal }));
      yield* dispatch("fresh-request");
      assert.lengthOf(
        (yield* Context.get(b, Projection.ProjectionStoreV2).getThreadRecords(threadId, ["runs"]))
          .runs,
        1,
      );
      yield* Context.get(b, EffectWorker.OrchestrationEffectWorkerV2).drain();
      yield* Deferred.await(didStart);
      assert.lengthOf(started, 1);
      assert.include(JSON.stringify(started[0]!.message), "What was the latest plan?");
      assert.include(JSON.stringify(started[0]), "Corrected latest plan");
      assert.include(JSON.stringify(started[0]), "historical records, not new requests");
      assert.isFalse(JSON.stringify(started[0]).includes("large original-only file"));
      yield* Context.get(b, EffectWorker.OrchestrationEffectWorkerV2).drain();
      assert.lengthOf(started, 1);
      const before = yield* second.status;
      yield* fs.writeFileString(
        `${root}/AGENTS.md`,
        "A newer instruction while the other copy is busy",
      );
      const blocked = yield* Effect.exit(
        second.receive(
          yield* first.read({ projectId, includeManifest: true, after: page2.cursor! }),
        ),
      );
      assert.equal(blocked._tag, "Failure");
      assert.deepEqual((yield* second.status).cursors, before.cursors);
      assert.equal(
        yield* fs.readFileString(`${copy.value.workspaceRoot}/AGENTS.md`),
        "Remember: three days per week.",
      );
    }).pipe(Effect.scoped),
);

it.effect("primary and per-bot overrides converge after a disconnected settings edit", () =>
  Effect.gen(function* () {
    const a = Context.get(yield* Layer.build(fixture("a")), Replication.BotReplication);
    const b = Context.get(yield* Layer.build(fixture("b")), Replication.BotReplication);
    const value = yield* a.configure({
      primaryEnvironmentId: EnvironmentId.make("a"),
      override: { projectId, environmentId: EnvironmentId.make("b") },
    });
    yield* b.mergePreferences(value);
    const next = yield* b.configure({
      primaryEnvironmentId: EnvironmentId.make("b"),
      override: { projectId, environmentId: null },
    });
    yield* a.mergePreferences(next);
    yield* a.mergePreferences(value);
    assert.deepEqual((yield* a.status).preferences, (yield* b.status).preferences);
    assert.deepEqual((yield* a.status).preferences.overrides, {});
  }).pipe(Effect.scoped),
);

it.effect("keeps divergent memory instead of overwriting a local correction", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/AGENTS.md`, "Local correction");
    yield* Files.reconcile(
      root,
      {
        version: 1,
        botId: BotId.make("fitness"),
        files: [{ path: "AGENTS.md", text: "Remote correction" }],
        localFiles: [],
      },
      [{ path: "AGENTS.md", text: "Old text" }],
    );
    assert.equal(yield* fs.readFileString(`${root}/AGENTS.md`), "Local correction");
    const conflicts = yield* fs.readDirectory(`${root}/memory/replica-conflicts`);
    assert.lengthOf(conflicts, 1);
    assert.include(
      yield* fs.readFileString(`${root}/memory/replica-conflicts/${conflicts[0]}`),
      "Remote correction",
    );
    const captured = yield* Files.capture({
      workspaceRoot: root,
      environmentId: EnvironmentId.make("local"),
      botId: BotId.make("fitness"),
    });
    assert.deepEqual(
      captured.files.map((file) => file.path),
      ["AGENTS.md"],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("propagates a removed memory only when the replica has not changed it", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/MEMORY.md`, "Forget this old fact");
    yield* fs.writeFileString(`${root}/AGENTS.md`, "New local instruction");
    const result = yield* Files.reconcile(
      root,
      {
        version: 1,
        botId: BotId.make("fitness"),
        files: [],
        localFiles: [],
      },
      [
        { path: "MEMORY.md", text: "Forget this old fact" },
        { path: "AGENTS.md", text: "Old instruction" },
      ],
    );
    assert.deepEqual(result.removed, ["MEMORY.md"]);
    assert.isFalse(yield* fs.exists(`${root}/MEMORY.md`));
    assert.equal(yield* fs.readFileString(`${root}/AGENTS.md`), "New local instruction");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "replicates voice inheritance and complex models without copying account credentials",
  () =>
    Effect.gen(function* () {
      const aContext = yield* Layer.build(fixture("voice-a"));
      const bContext = yield* Layer.build(fixture("voice-b"));
      const a = Context.get(aContext, Replication.BotReplication);
      const b = Context.get(bContext, Replication.BotReplication);
      const aSettings = Context.get(aContext, Settings.ServerSettingsService);
      const bSettings = Context.get(bContext, Settings.ServerSettingsService);
      yield* aSettings.updateSettings({
        voiceConnections: { first: { kind: "openai-api", name: "Voice", apiKey: "secret-a" } },
      });
      yield* bSettings.updateSettings({
        voiceConnections: { second: { kind: "openai-api", name: "Voice", apiKey: "secret-b" } },
        projectSettingsOverrides: { [projectId]: { voiceSelection: null } },
      });
      const selection = { connectionId: "first", model: "realtime", voice: "ash" };
      const complex = {
        instanceId: ProviderInstanceId.make("codex"),
        model: "complex",
        options: [{ id: "reasoningEffort", value: "medium" }],
      };
      const shared = yield* a.configure({
        defaultVoiceSelection: selection,
        voiceOverride: { projectId, selection: "inherit" },
        complexTaskModelSelection: complex,
      });
      assert.notInclude(JSON.stringify(shared), "secret-a");
      yield* b.mergePreferences(shared);
      const saved = yield* bSettings.getSettings;
      assert.deepEqual(botVoiceSelection(saved, projectId), {
        kind: "default",
        selection: { ...selection, connectionId: "second" },
      });
      assert.deepEqual(botComplexTaskModel(saved.botSharedPreferences, projectId), complex);
      const own = yield* b.configure({
        voiceOverride: { projectId, selection: null },
        complexTaskModelOverride: { projectId, selection: { ...complex, model: "specialist" } },
      });
      yield* a.mergePreferences(own);
      assert.deepEqual(botVoiceSelection(yield* aSettings.getSettings, projectId), {
        kind: "own",
        selection: null,
      });
      const inherited = yield* b.configure({
        voiceOverride: { projectId, selection: "inherit" },
        complexTaskModelOverride: { projectId, selection: null },
      });
      yield* a.mergePreferences(inherited);
      assert.deepEqual(botVoiceSelection(yield* aSettings.getSettings, projectId), {
        kind: "default",
        selection,
      });
      assert.deepEqual(botComplexTaskModel(inherited, projectId), complex);
      const runtime = yield* b.configure({
        runtimeOverride: { projectId, modelSelection: complex, runtimeMode: "approval-required" },
      });
      yield* a.mergePreferences(runtime);
      assert.deepEqual(
        (yield* aSettings.getSettings).projectSettingsOverrides[projectId]?.defaultModelSelection,
        complex,
      );
      assert.equal(
        (yield* aSettings.getSettings).projectSettingsOverrides[projectId]?.defaultRuntimeMode,
        "approval-required",
      );
      const reset = yield* b.configure({
        runtimeOverride: { projectId, modelSelection: null, runtimeMode: null },
      });
      yield* a.mergePreferences(reset);
      assert.isUndefined(
        (yield* aSettings.getSettings).projectSettingsOverrides[projectId]?.defaultModelSelection,
      );
      assert.isUndefined(
        (yield* aSettings.getSettings).projectSettingsOverrides[projectId]?.defaultRuntimeMode,
      );
    }).pipe(Effect.scoped),
);

it.effect("replicates collapsed calls and repairs transcript identities from older copies", () =>
  Effect.gen(function* () {
    const a = yield* Layer.build(fixture("voice-origin"));
    const b = yield* Layer.build(fixture("voice-copy"));
    const first = Context.get(a, Replication.BotReplication);
    const second = Context.get(b, Replication.BotReplication);
    const fs = Context.get(a, FileSystem.FileSystem);
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "replica-call-" });
    yield* Context.get(a, Projects.ProjectService).create({
      commandId: CommandId.make("voice-project"),
      projectId,
      title: "Fitness",
      workspaceRoot: root,
      botRole: "specialist",
    });
    const sink = Context.get(a, Sink.EventSinkV2);
    yield* sink.write({
      events: [
        {
          id: EventId.make("voice-thread"),
          type: "thread.created",
          threadId,
          occurredAt: now,
          payload: sourceThread,
        },
      ],
    });
    const message = {
      id: MessageId.make("voice-message"),
      threadId,
      runId: null,
      nodeId: null,
      createdBy: "user" as const,
      creationSource: "server" as const,
      role: "user" as const,
      text: "We discussed capuchin monkeys.",
      attachments: [],
      streaming: false,
      voiceCall: { callId: "call", entryId: "speech", ordinal: 0, revision: 0, final: true },
      createdAt: now,
      updatedAt: now,
    };
    yield* sink.write({
      events: [
        {
          id: EventId.make("voice-message"),
          type: "message.updated",
          threadId,
          occurredAt: now,
          payload: message,
        },
      ],
    });
    const page = yield* first.read({ projectId, includeManifest: true });
    // Simulate a previously installed receiver that discarded voice metadata.
    yield* second.receive({
      ...page,
      messages: page.messages.map(({ voiceCall: _call, ...rest }) => rest),
    });
    yield* second.receive(page);
    const call = {
      id: TurnItemId.make("voice-call:call"),
      type: "voice_call" as const,
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed" as const,
      title: "Fitness",
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      voiceOwner: "private-client",
      voiceWriters: [{ owner: "private-client", ordinalOffset: 0 }],
      call: {
        callId: "call",
        botTitle: "Fitness",
        startedAt: DateTime.formatIso(now),
        endedAt: DateTime.formatIso(now),
        endReason: "user" as const,
      },
    };
    yield* sink.write({
      events: [
        {
          id: EventId.make("voice-ended"),
          type: "turn-item.updated",
          threadId,
          occurredAt: now,
          payload: call,
        },
      ],
    });
    const next = yield* first.read({ projectId, includeManifest: false, after: page.cursor! });
    assert.lengthOf(next.calls!, 1);
    assert.notProperty(next.calls![0], "voiceOwner");
    assert.notProperty(next.calls![0], "voiceWriters");
    yield* second.receive(next);
    yield* second.receive(next);
    const records = yield* Context.get(b, Projection.ProjectionStoreV2).getThreadRecords(threadId, [
      "messages",
      "turnItems",
    ]);
    assert.deepEqual(records.messages[0]!.voiceCall, message.voiceCall);
    assert.equal(records.messages[0]!.text, message.text);
    assert.lengthOf(
      records.turnItems.filter((item) => item.type === "voice_call"),
      1,
    );
    const projection = yield* Context.get(b, Projection.ProjectionStoreV2).getThreadProjection(
      threadId,
    );
    assert.deepEqual(
      projection.visibleTurnItems.map((row) => row.item.type),
      ["voice_call"],
    );
    assert.equal(records.turnItems.find((item) => item.type === "voice_call")!.ordinal, 1);
    const backward = yield* second.read({ projectId, includeManifest: true });
    yield* first.receive(backward);
    const unchanged = yield* first.read({ projectId, includeManifest: false, after: next.cursor! });
    assert.lengthOf(unchanged.messages, 0);
    assert.lengthOf(unchanged.calls!, 0);
  }).pipe(Effect.scoped),
);

it.effect("initializes shared defaults once, including Sol, and preserves explicit choices", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(fixture("default-host"));
    const settings = Context.get(context, Settings.ServerSettingsService);
    const replication = Context.get(context, Replication.BotReplication);
    const providers = [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: "2026-10-26T12:00:00Z",
        models: ["gpt-6.1-sol", "gpt-6-astra"].map((slug) => ({
          slug,
          name: slug,
          isCustom: false,
          capabilities: null,
        })),
        slashCommands: [],
        skills: [],
      },
    ];
    yield* settings.updateSettings({
      voiceConnections: {
        chatgpt: {
          kind: "codex-subscription",
          name: "ChatGPT",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
      },
    });
    yield* replication.initializeDefaults(providers);
    const initialized = (yield* settings.getSettings).botSharedPreferences;
    assert.equal(initialized.defaultVoice?.voice, "sol");
    assert.equal(initialized.defaultModelSelection?.model, "gpt-6.1-sol");
    yield* replication.initializeDefaults(providers);
    assert.equal((yield* settings.getSettings).botSharedPreferences.revision, initialized.revision);
    const claude = {
      ...providers[0]!,
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claudeAgent"),
      models: ["claude-haiku-5-5", "claude-opus-5-5"].map((slug) => ({
        slug,
        name: slug,
        isCustom: false,
        capabilities: null,
      })),
    };
    yield* replication.initializeDefaults([...providers, claude]);
    const preferred = (yield* settings.getSettings).botSharedPreferences;
    assert.equal(preferred.defaultModelSelection?.model, "claude-haiku-5-5");
    assert.equal(preferred.complexTaskModelSelection?.model, "claude-opus-5-5");
    yield* replication.initializeDefaults(providers);
    assert.equal(
      (yield* settings.getSettings).botSharedPreferences.defaultModelSelection?.model,
      "claude-haiku-5-5",
    );
    yield* replication.configure({
      defaultVoiceSelection: null,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "custom",
        options: [{ id: "reasoningEffort", value: "max" }],
      },
    });
    yield* replication.initializeDefaults([...providers, claude]);
    const manual = (yield* settings.getSettings).botSharedPreferences;
    assert.isNull(manual.defaultVoice);
    assert.equal(manual.defaultModelSelection?.model, "custom");
  }).pipe(Effect.scoped),
);
