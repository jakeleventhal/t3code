import * as PeerEnvironmentBroker from "../mcp/PeerEnvironmentBroker.ts";
import * as BotContext from "./BotContext.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  type BotFileContextRecord,
  EventId,
  MessageId,
  TurnItemId,
  type ChatAttachment,
  type ThreadId,
  ProjectId,
  ProviderInstanceId,
  type BotOpenInput,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as BotWorkspace from "./BotWorkspace.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { OrchestratorDispatchError } from "../orchestration-v2/Orchestrator.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectEnrichment from "../project/ProjectEnrichmentService.ts";
import * as Favicon from "../project/ProjectFaviconResolver.ts";
import * as Repository from "../project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as BotService from "./BotService.ts";

const options: BotOpenInput = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  creationSource: "web",
};

const dependencies = Layer.mergeAll(
  RuntimeLayer.layerProjectService,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(
  Layer.provideMerge(ProjectEnrichment.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.succeed(Repository.RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
      Layer.succeed(Favicon.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: () => Effect.succeed(null),
      }),
      Layer.mock(WorkspacePaths.WorkspacePaths)({ normalizeWorkspaceRoot: Effect.succeed }),
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-bot-service-" })),
  Layer.provideMerge(NodeServices.layer),
);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-bot-workspace-" });
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const failNext = yield* Ref.make(false);
  const rejectedCommands = yield* Ref.make<ReadonlySet<CommandId>>(new Set());
  const creates = yield* Ref.make(0);
  const dispatch: ThreadManagement.ThreadManagementService["Service"]["dispatch"] = Effect.fn(
    "BotServiceTest.dispatch",
  )(function* (command) {
    if (
      (yield* Ref.getAndSet(failNext, false)) ||
      (yield* Ref.get(rejectedCommands)).has(command.commandId)
    ) {
      yield* Ref.update(rejectedCommands, (ids) => new Set([...ids, command.commandId]));
      return yield* new OrchestratorDispatchError({
        commandId: command.commandId,
        commandType: command.type,
      });
    }
    const now = yield* DateTime.now;
    if (command.type === "thread.create") {
      yield* Ref.update(creates, (n) => n + 1);
      yield* projections
        .apply({
          id: EventId.make(command.commandId),
          type: "thread.created",
          threadId: command.threadId,
          occurredAt: now,
          payload: {
            id: command.threadId,
            projectId: command.projectId,
            title: command.title,
            modelSelection: command.modelSelection,
            providerInstanceId: command.modelSelection.instanceId,
            runtimeMode: command.runtimeMode,
            interactionMode: command.interactionMode,
            createdBy: command.createdBy,
            creationSource: command.creationSource,
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: {
              parentThreadId: null,
              relationshipToParent: null,
              rootThreadId: command.threadId,
            },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        })
        .pipe(Effect.orDie);
    } else if (command.type === "thread.unarchive") {
      const thread = yield* projections.getThread(command.threadId).pipe(Effect.orDie);
      yield* projections
        .apply({
          id: EventId.make(command.commandId),
          type: "thread.unarchived",
          threadId: thread.id,
          occurredAt: now,
          payload: { ...thread, archivedAt: null },
        })
        .pipe(Effect.orDie);
    } else return yield* Effect.die(`Unexpected command ${command.type}`);
    return { sequence: 1, storedEvents: [] };
  });
  const serviceLayer = Layer.mergeAll(
    BotService.layer,
    BotContext.layer.pipe(Layer.provide(PeerEnvironmentBroker.layer)),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        BotWorkspace.layer,
        Layer.mock(ThreadManagement.ThreadManagementService)({ dispatch }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          prepareBotWorkspace: (id) => {
            const folder = path.join(root, encodeURIComponent(id));
            return fs
              .makeDirectory(folder, { recursive: true })
              .pipe(Effect.as(folder), Effect.orDie);
          },
        }),
      ),
    ),
  );
  return { serviceLayer, failNext, creates };
});

it.effect("concurrent desktop and phone opens share one Assistant and preserve its settings", () =>
  Effect.gen(function* () {
    const { serviceLayer, creates } = yield* fixture;
    yield* Effect.gen(function* () {
      const bots = yield* BotService.BotService;
      const opened = yield* Effect.all(
        Array.from({ length: 8 }, () => bots.open(options)),
        { concurrency: "unbounded" },
      );
      assert.equal(new Set(opened.map((r) => r.threadId)).size, 1);
      assert.equal(new Set(opened.map((r) => r.projectId)).size, 1);
      assert.equal(yield* Ref.get(creates), 1);
      const first = opened[0]!;
      const next = yield* bots.open({
        ...options,
        creationSource: "mobile",
        runtimeMode: "approval-required",
        modelSelection: { ...options.modelSelection, model: "another" },
      });
      assert.deepEqual(next, first);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const thread = yield* projections.getThread(first.threadId);
      assert.deepEqual(thread.modelSelection, options.modelSelection);
      assert.equal(thread.runtimeMode, options.runtimeMode);
      assert.equal(yield* projections.getMessageCount(first.threadId), 0);
    }).pipe(Effect.provide(serviceLayer));
  }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "retry after an interrupted first open uses the reserved main id across service restarts",
  () =>
    Effect.gen(function* () {
      const { serviceLayer, failNext, creates } = yield* fixture;
      yield* Ref.set(failNext, true);
      const result = yield* BotService.BotService.pipe(
        Effect.flatMap((bots) => bots.open(options)),
        Effect.result,
        Effect.provide(serviceLayer),
      );
      assert.equal(result._tag, "Failure");
      const projects = yield* ProjectService.ProjectService;
      const reserved = (yield* projects.snapshot).projects[0]!;
      assert.isNotNull(reserved.botMainThreadId);
      const resumed = yield* BotService.BotService.pipe(
        Effect.flatMap((bots) => bots.open({ ...options, creationSource: "mobile" })),
        Effect.provide(serviceLayer),
      );
      assert.equal(resumed.projectId, reserved.id);
      assert.equal(resumed.threadId, reserved.botMainThreadId);
      assert.equal(yield* Ref.get(creates), 1);
      assert.equal((yield* projects.snapshot).projects.length, 1);
    }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "specialist creation retries are idempotent while distinct requests remain separate",
  () =>
    Effect.gen(function* () {
      const { serviceLayer } = yield* fixture;
      yield* Effect.gen(function* () {
        const bots = yield* BotService.BotService;
        const request = { ...options, name: "Fitness", commandId: CommandId.make("fitness-1") };
        const [first, retry] = yield* Effect.all([bots.create(request), bots.create(request)], {
          concurrency: "unbounded",
        });
        assert.deepEqual(first, retry);
        const second = yield* bots.create({ ...request, commandId: CommandId.make("fitness-2") });
        assert.notEqual(first.threadId, second.threadId);
        const projects = yield* ProjectService.ProjectService;
        const firstProject = Option.getOrThrow(yield* projects.getById(first.projectId));
        const secondProject = Option.getOrThrow(yield* projects.getById(second.projectId));
        assert.equal(firstProject.botRole, "specialist");
        assert.notEqual(firstProject.workspaceRoot, secondProject.workspaceRoot);
        assert.deepEqual(yield* bots.open({ ...options, projectId: first.projectId }), first);
      }).pipe(Effect.provide(serviceLayer));
    }).pipe(Effect.provide(dependencies)),
);

it.effect("reopens an archived main and replaces only an explicitly deleted conversation", () =>
  Effect.gen(function* () {
    const { serviceLayer, creates } = yield* fixture;
    yield* Effect.gen(function* () {
      const bots = yield* BotService.BotService;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const first = yield* bots.open(options);
      const now = yield* DateTime.now;
      const original = yield* projections.getThread(first.threadId);
      yield* projections.apply({
        id: EventId.make("archive"),
        type: "thread.archived",
        threadId: first.threadId,
        occurredAt: now,
        payload: { ...original, archivedAt: now },
      });
      assert.deepEqual(yield* bots.open(options), first);
      assert.isNull((yield* projections.getThread(first.threadId)).archivedAt);
      yield* projections.apply({
        id: EventId.make("delete"),
        type: "thread.deleted",
        threadId: first.threadId,
        occurredAt: now,
        payload: { ...original, deletedAt: now },
      });
      const replacement = yield* bots.open(options);
      assert.equal(replacement.projectId, first.projectId);
      assert.notEqual(replacement.threadId, first.threadId);
      assert.isNotNull((yield* projections.getThread(first.threadId)).deletedAt);
      assert.equal(yield* Ref.get(creates), 2);
    }).pipe(Effect.provide(serviceLayer));
  }).pipe(Effect.provide(dependencies)),
);

it.effect("does not turn an ordinary Code project into a bot", () =>
  Effect.gen(function* () {
    const { serviceLayer, creates } = yield* fixture;
    const projects = yield* ProjectService.ProjectService;
    const projectId = ProjectId.make("code");
    yield* projects.create({
      commandId: CommandId.make("create-code"),
      projectId,
      title: "Code",
      workspaceRoot: "/code",
    });
    const error = yield* BotService.BotService.pipe(
      Effect.flatMap((bots) => bots.open({ ...options, projectId })),
      Effect.flip,
      Effect.provide(serviceLayer),
    );
    assert.equal(error.operation, "read-project");
    assert.equal(yield* Ref.get(creates), 0);
    assert.isNull(Option.getOrThrow(yield* projects.getById(projectId)).botMainThreadId);
  }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "lists only a bot's published chat files with stable bounded pagination and source links",
  () =>
    Effect.gen(function* () {
      const { serviceLayer } = yield* fixture;
      yield* Effect.gen(function* () {
        const bots = yield* BotService.BotService;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const assistant = yield* bots.open(options);
        const other = yield* bots.create({
          ...options,
          commandId: CommandId.make("fitness-files"),
          name: "Fitness",
        });
        const at = DateTime.makeUnsafe("2026-10-24T10:00:00.000Z");
        const addMessage = Effect.fn("BotFilesTest.addMessage")(function* (
          threadId: ThreadId,
          id: string,
          attachments: ReadonlyArray<ChatAttachment>,
        ) {
          yield* projections.apply({
            id: EventId.make(id),
            type: "message.updated",
            threadId,
            occurredAt: at,
            payload: {
              id: MessageId.make(id),
              threadId,
              runId: null,
              nodeId: null,
              role: "user",
              text: "shared files",
              attachments,
              streaming: false,
              createdBy: "user",
              creationSource: "web",
              createdAt: at,
              updatedAt: at,
            },
          });
        });
        const attachment = (id: string): ChatAttachment => ({
          type: "file",
          id,
          name: `${id}.csv`,
          mimeType: "text/csv",
          sizeBytes: 123,
        });
        yield* addMessage(assistant.threadId, "main", [attachment("first"), attachment("second")]);
        yield* addMessage(other.threadId, "other", [attachment("private")]);
        yield* projections.apply({
          id: EventId.make("report"),
          type: "turn-item.updated",
          threadId: assistant.threadId,
          occurredAt: at,
          payload: {
            id: TurnItemId.make("report"),
            threadId: assistant.threadId,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            type: "dynamic_tool",
            status: "completed",
            title: "Report",
            startedAt: at,
            completedAt: at,
            updatedAt: at,
            toolName: "mcp__t3_code__html_render",
            input: {},
            output: {
              htmlRender: { attachmentId: "report-html", title: "Weekly report", height: 400 },
            },
          },
        });
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const context = yield* BotContext.BotContext;
        const environmentId = EnvironmentId.make(
          (yield* fs.readFileString(config.environmentIdPath)).trim(),
        );
        yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
        const attachmentPath = path.join(config.attachmentsDir, "first.bin");
        yield* fs.writeFileString(attachmentPath, "published data");
        const htmlPath = path.join(config.attachmentsDir, "report-html.bin");
        yield* fs.writeFileString(htmlPath, "<p>Published report</p>");
        const reference: BotFileContextRecord = {
          kind: "bot-file",
          version: 1,
          contextId: ComposerContextId.make("sharedfile"),
          label: "File",
          title: "File",
          environmentId,
          projectId: assistant.projectId,
          fileId: "message:main:0",
          fileKind: "attachment",
          attachmentId: "first",
          sourceThreadId: assistant.threadId,
          sourceMessageId: MessageId.make("main"),
        };
        const htmlReference: BotFileContextRecord = {
          ...reference,
          contextId: ComposerContextId.make("htmlfile"),
          fileId: "item:report",
          fileKind: "html",
          attachmentId: "report-html",
          sourceTurnItemId: TurnItemId.make("report"),
        };
        const remote = {
          ...reference,
          contextId: ComposerContextId.make("remote"),
          environmentId: EnvironmentId.make("remote"),
        };
        const forged = {
          ...reference,
          contextId: ComposerContextId.make("forged"),
          projectId: other.projectId,
        };
        const resolver = yield* context.resolveFileReferences(assistant.threadId, [
          reference,
          htmlReference,
          remote,
          forged,
        ]);
        assert.equal(resolver(reference.attachmentId, reference), attachmentPath);
        assert.equal(resolver(htmlReference.attachmentId, htmlReference), htmlPath);
        assert.isNull(resolver(remote.attachmentId, remote));
        assert.isNull(resolver(forged.attachmentId, forged));
        const first = yield* bots.files({ projectId: assistant.projectId, limit: 1 });
        assert.equal(first.items.length, 1);
        assert.equal(first.items[0]?.title, "second.csv");
        assert.equal(first.items[0]?.sourceMessageId, "main");
        assert.isNotNull(first.nextCursor);
        const searched = yield* bots.files({
          projectId: assistant.projectId,
          limit: 1,
          query: "FIRST",
        });
        assert.equal(searched.items[0]?.title, "first.csv");
        assert.isNull(searched.nextCursor);
        assert.equal(
          (yield* bots.files({ projectId: assistant.projectId, query: "Weekly report" })).items[0]
            ?.kind,
          "html",
        );
        assert.equal(
          (yield* bots.files({ projectId: assistant.projectId, query: "private" })).items.length,
          0,
        );

        const second = yield* bots.files({
          projectId: assistant.projectId,
          limit: 1,
          cursor: first.nextCursor!,
        });
        assert.equal(second.items[0]?.title, "first.csv");
        const third = yield* bots.files({
          projectId: assistant.projectId,
          limit: 1,
          cursor: second.nextCursor!,
        });
        assert.equal(third.items[0]?.kind, "html");
        assert.equal(third.items[0]?.title, "Weekly report");
        assert.equal(third.items[0]?.sourceTurnItemId, "report");
        assert.equal(third.items[0]?.sourceThreadId, assistant.threadId);
        assert.isNull(third.nextCursor);
        assert.deepEqual(
          (yield* bots.files({ projectId: other.projectId })).items.map((f) => f.title),
          ["private.csv"],
        );
        const thread = yield* projections.getThread(other.threadId);
        yield* projections.apply({
          id: EventId.make("delete-other"),
          type: "thread.deleted",
          threadId: other.threadId,
          occurredAt: at,
          payload: { ...thread, deletedAt: at },
        });
        assert.deepEqual((yield* bots.files({ projectId: other.projectId })).items, []);
        assert.equal(
          (yield* bots.files({ projectId: ProjectId.make("missing") }).pipe(Effect.flip))._tag,
          "BotOperationError",
        );
      }).pipe(Effect.provide(serviceLayer));
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "persists bot photos as immutable files and replacing them clears an emoji override",
  () =>
    Effect.gen(function* () {
      const { serviceLayer } = yield* fixture;
      yield* Effect.gen(function* () {
        const bots = yield* BotService.BotService;
        const projects = yield* ProjectService.ProjectService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const bot = yield* bots.open(options);
        yield* projects.update({
          commandId: CommandId.make("emoji"),
          projectId: bot.projectId,
          projectIcon: { kind: "emoji", emoji: "🌻" },
        });
        const request = {
          commandId: CommandId.make("photo"),
          projectId: bot.projectId,
          image: { mimeType: "image/png" as const, dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
        };
        const first = yield* bots.setAvatar(request);
        const retry = yield* bots.setAvatar(request);
        assert.isNull(first.projectIcon);
        assert.equal(first.faviconPath, retry.faviconPath);
        assert.deepEqual(
          Array.from(yield* fs.readFile(path.join(first.workspaceRoot, first.faviconPath!))),
          [137, 80, 78, 71, 13, 10, 26, 10],
        );
        const next = yield* bots.setAvatar({
          ...request,
          commandId: CommandId.make("photo-next"),
          image: { mimeType: "image/gif", dataUrl: "data:image/gif;base64,R0lGODlh" },
        });
        assert.notEqual(next.faviconPath, first.faviconPath);
        assert.isTrue(yield* fs.exists(path.join(first.workspaceRoot, first.faviconPath!)));
        const error = yield* bots
          .setAvatar({
            ...request,
            commandId: CommandId.make("bad-photo"),
            image: { mimeType: "image/png", dataUrl: "data:text/html;base64,SGVsbG8=" },
          })
          .pipe(Effect.flip);
        assert.equal(error.operation, "save-avatar");
        const current = yield* projects.getById(bot.projectId);
        assert.isTrue(Option.isSome(current));
        if (Option.isSome(current)) assert.equal(current.value.faviconPath, next.faviconPath);
      }).pipe(Effect.provide(serviceLayer));
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "bot parallel threads inherit settings, retry without duplicates, and preserve main",
  () =>
    Effect.gen(function* () {
      const { serviceLayer, creates } = yield* fixture;
      yield* Effect.gen(function* () {
        const bots = yield* BotService.BotService;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const settings = yield* ServerSettings.ServerSettingsService;
        const main = yield* bots.open(options);
        const modelSelection = { ...options.modelSelection, model: "chosen-bot-model" };
        yield* settings.updateSettings({
          botDefaults: {
            defaultModelSelection: modelSelection,
            defaultRuntimeMode: "approval-required",
          },
        });
        const input = {
          commandId: CommandId.make("parallel-workout"),
          projectId: main.projectId,
          title: "New workout plan",
        };
        const results = yield* Effect.all(
          Array.from({ length: 4 }, () =>
            bots.createThread(input, { createdBy: "agent", creationSource: "mcp" }),
          ),
          { concurrency: "unbounded" },
        );
        assert.equal(new Set(results.map((result) => result.threadId)).size, 1);
        const secondary = results[0]!;
        assert.notEqual(secondary.threadId, main.threadId);
        assert.equal(yield* Ref.get(creates), 2);
        const thread = yield* projections.getThread(secondary.threadId);
        assert.equal(thread.title, input.title);
        assert.deepEqual(thread.modelSelection, modelSelection);
        assert.equal(thread.runtimeMode, "approval-required");
        assert.equal(thread.createdBy, "agent");
        assert.equal(thread.creationSource, "mcp");
        assert.equal(yield* projections.getMessageCount(thread.id), 0);
        const original = yield* projections.getThread(main.threadId);
        assert.deepEqual(original.modelSelection, options.modelSelection);
        const projects = yield* ProjectService.ProjectService;
        assert.equal(
          Option.getOrThrow(yield* projects.getById(main.projectId)).botMainThreadId,
          main.threadId,
        );
        const invalid = yield* bots
          .createThread({ ...input, projectId: ProjectId.make("missing") })
          .pipe(Effect.result);
        assert.equal(invalid._tag, "Failure");
      }).pipe(Effect.provide(serviceLayer));
    }).pipe(Effect.provide(dependencies)),
);

it.effect("bot inbox previews are bounded and skip internal messages in snapshot and updates", () =>
  Effect.gen(function* () {
    const { serviceLayer } = yield* fixture;
    yield* Effect.gen(function* () {
      const bots = yield* BotService.BotService;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const main = yield* bots.open(options);
      const at = DateTime.makeUnsafe("2026-10-24T12:00:00Z");
      for (const [id, role, text, createdBy, workflowScript] of [
        ["a", "user", "My question", "user", false],
        ["b", "assistant", "Useful response ".repeat(1000), "agent", false],
        ["c", "user", "Internal task request", "agent", false],
        ["d", "user", "Internal workflow", "user", true],
      ] as const) {
        yield* projections.apply({
          id: EventId.make(`preview-${id}`),
          type: "message.updated",
          threadId: main.threadId,
          occurredAt: at,
          payload: {
            id: MessageId.make(id),
            threadId: main.threadId,
            runId: null,
            nodeId: null,
            role,
            text,
            createdBy,
            workflowScript,
            attachments: [],
            streaming: false,
            creationSource: "mcp",
            createdAt: at,
            updatedAt: at,
          },
        });
      }
      const snapshot = yield* projections.getShellSnapshot();
      const preview = snapshot.threads.find(
        (thread) => thread.id === main.threadId,
      )?.latestVisibleMessage;
      assert.equal(preview?.id, MessageId.make("b"));
      assert.equal(preview?.text, "Useful response ".repeat(1000).slice(0, 240));
      const updated = yield* projections.getThreadShell(main.threadId);
      assert.deepEqual(updated?.latestVisibleMessage, preview);
    }).pipe(Effect.provide(serviceLayer));
  }).pipe(Effect.provide(dependencies)),
);
