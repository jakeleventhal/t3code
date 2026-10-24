import {
  BotOperationError,
  BotFile,
  type BotFilesInput,
  type BotFilesPage,
  type BotSetAvatarInput,
  MessageId,
  TurnItemId,
  ChatAttachment,
  type BotOpenInput,
  type BotCreateInput,
  type BotConversationResult,
  CommandId,
  ProjectId,
  type Project,
  ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";

import * as ProjectService from "../project/ProjectService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as BotWorkspace from "./BotWorkspace.ts";

const decodeAttachment = Schema.decodeEffect(Schema.fromJsonString(ChatAttachment));
const decodeHtmlOutput = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      toolName: Schema.NullOr(Schema.String),
      output: Schema.Unknown,
    }),
  ),
);
const decodeFile = Schema.decodeUnknownOption(BotFile);

export class BotService extends Context.Service<
  BotService,
  {
    readonly files: (input: BotFilesInput) => Effect.Effect<BotFilesPage, BotOperationError>;
    readonly setAvatar: (input: BotSetAvatarInput) => Effect.Effect<Project, BotOperationError>;
    readonly open: (
      input: BotOpenInput,
      provenance?: ThreadManagement.ThreadManagementProvenance,
    ) => Effect.Effect<BotConversationResult, BotOperationError>;
    readonly create: (
      input: BotCreateInput,
      provenance?: ThreadManagement.ThreadManagementProvenance,
    ) => Effect.Effect<BotConversationResult, BotOperationError>;
  }
>()("t3/bots/BotService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectService.ProjectService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const workspace = yield* BotWorkspace.BotWorkspace;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const locks = yield* KeyedLock.make<string>();
  const failure =
    (operation: BotOperationError["operation"], projectId?: ProjectId) => (cause: unknown) =>
      new BotOperationError({
        operation,
        ...(projectId === undefined ? {} : { projectId }),
        cause,
      });

  const readBot = Effect.fn("BotService.readBot")(function* (projectId: ProjectId) {
    const result = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError(failure("read-project", projectId)));
    if (Option.isNone(result) || result.value.botRole == null) {
      return yield* failure("read-project", projectId)("The bot was not found.");
    }
    return result.value;
  });

  const ensureMain = Effect.fn("BotService.ensureMain")(function* (
    project: Project,
    input: BotOpenInput,
    provenance?: ThreadManagement.ThreadManagementProvenance,
  ) {
    yield* workspace
      .initialize(project.workspaceRoot, project.botRole!)
      .pipe(Effect.mapError(failure("prepare-workspace", project.id)));
    let threadId = project.botMainThreadId ?? null;
    const existing =
      threadId === null
        ? null
        : yield* projections
            .getThread(threadId)
            .pipe(
              Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }),
              Effect.mapError(failure("open-thread", project.id)),
            );
    if (existing !== null && existing.projectId !== project.id) {
      return yield* failure(
        "open-thread",
        project.id,
      )("The main conversation belongs to another project.");
    }
    if (existing !== null && existing.deletedAt === null) {
      if (existing.archivedAt !== null) {
        const id = yield* crypto
          .randomUUIDv4()
          .pipe(Effect.mapError(failure("open-thread", project.id)));
        yield* threads
          .dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make(id),
            threadId: existing.id,
          })
          .pipe(Effect.mapError(failure("open-thread", project.id)));
      }
      return { projectId: project.id, threadId: existing.id };
    }
    if (threadId === null || existing?.deletedAt != null) {
      threadId = ThreadId.make(
        yield* crypto.randomUUIDv4().pipe(Effect.mapError(failure("open-thread", project.id))),
      );
      // Reserve the id before creation so a retry after interruption finishes
      // the same conversation rather than leaving an extra empty thread.
      yield* projects
        .update({
          commandId: CommandId.make(`bot-main-bind:${threadId}`),
          projectId: project.id,
          botMainThreadId: threadId,
          ...(project.defaultModelSelection === null
            ? { defaultModelSelection: input.modelSelection }
            : {}),
        })
        .pipe(Effect.mapError(failure("open-thread", project.id)));
    }
    // Rejected commands retain their outcome. Keep the reserved thread id,
    // but allow a new attempt after the provider or its settings are corrected.
    const createCommandId = yield* crypto
      .randomUUIDv4()
      .pipe(Effect.mapError(failure("open-thread", project.id)));
    yield* threads
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(createCommandId),
        threadId,
        projectId: project.id,
        title: project.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        branch: null,
        worktreePath: null,
        createdBy: provenance?.createdBy ?? "user",
        creationSource: provenance?.creationSource ?? input.creationSource ?? "web",
      })
      .pipe(Effect.mapError(failure("open-thread", project.id)));
    return { projectId: project.id, threadId };
  });

  const createProject = Effect.fn("BotService.createProject")(function* (
    projectId: ProjectId,
    title: string,
    botRole: "assistant" | "specialist",
  ) {
    const workspaceRoot = yield* folders
      .prepareBotWorkspace(projectId)
      .pipe(Effect.mapError(failure("prepare-workspace", projectId)));
    return yield* projects
      .create({
        commandId: CommandId.make(`bot-create:${projectId}`),
        projectId,
        title,
        workspaceRoot,
        botRole,
      })
      .pipe(Effect.mapError(failure("create-project", projectId)));
  });

  const assistantProject = Effect.fn("BotService.assistantProject")(
    function* () {
      const snapshot = yield* projects.snapshot.pipe(Effect.mapError(failure("read-project")));
      const existing = snapshot.projects.find(
        (project) => project.botRole === "assistant" && project.deletedAt === null,
      );
      if (existing !== undefined) return existing;
      const id = yield* crypto.randomUUIDv4().pipe(Effect.mapError(failure("create-project")));
      return yield* createProject(ProjectId.make(id), "Assistant", "assistant");
    },
    (effect) => locks.withLock("assistant", effect),
  );

  const open = Effect.fn("BotService.open")(function* (
    input: BotOpenInput,
    provenance?: ThreadManagement.ThreadManagementProvenance,
  ) {
    const projectId = input.projectId ?? (yield* assistantProject()).id;
    return yield* locks.withLock(
      projectId,
      readBot(projectId).pipe(Effect.flatMap((project) => ensureMain(project, input, provenance))),
    );
  });

  const create = Effect.fn("BotService.create")(function* (
    input: BotCreateInput,
    provenance?: ThreadManagement.ThreadManagementProvenance,
  ) {
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(input.commandId))
      .pipe(Effect.map(Hex.encode), Effect.mapError(failure("create-project")));
    const projectId = ProjectId.make(`bot:${digest}`);
    return yield* locks.withLock(
      projectId,
      Effect.gen(function* () {
        const existing = yield* projects
          .getById(projectId, { includeDeleted: true })
          .pipe(Effect.mapError(failure("read-project", projectId)));
        const project = Option.isSome(existing)
          ? yield* readBot(projectId)
          : yield* createProject(projectId, input.name, "specialist");
        return yield* ensureMain(project, input, provenance);
      }),
    );
  });

  const files = Effect.fn("BotService.files")(
    function* (input: BotFilesInput) {
      yield* readBot(input.projectId);
      const limit = input.limit ?? 32;
      // Read only published chat assets, never the bot's working directory or full histories.
      const rows = yield* sql<{
        key: string;
        created_at: string;
        thread_id: string;
        message_id: string | null;
        item_id: string | null;
        payload: string;
      }>`
        WITH assets AS (
          SELECT 'message:' || m.message_id || ':' || a.key AS key,
            m.created_at, m.thread_id, m.message_id, NULL AS item_id, a.value AS payload
          FROM orchestration_v2_projection_threads AS t
          JOIN orchestration_v2_projection_messages AS m ON m.thread_id = t.thread_id,
            json_each(m.payload_json, '$.attachments') AS a
          WHERE t.project_id = ${input.projectId} AND t.deleted_at IS NULL
            AND m.role IN ('user', 'assistant')
            AND json_array_length(m.payload_json, '$.attachments') > 0
          UNION ALL
          SELECT 'item:' || i.turn_item_id AS key,
            COALESCE(json_extract(i.payload_json, '$.startedAt'), i.updated_at) AS created_at,
            i.thread_id, NULL AS message_id, i.turn_item_id AS item_id,
            json_object('toolName', json_extract(i.payload_json, '$.toolName'),
              'output', json_extract(i.payload_json, '$.output')) AS payload
          FROM orchestration_v2_projection_threads AS t
          JOIN orchestration_v2_projection_turn_items AS i ON i.thread_id = t.thread_id
          WHERE t.project_id = ${input.projectId} AND t.deleted_at IS NULL
            AND i.type = 'dynamic_tool' AND i.status = 'completed'
            AND json_extract(i.payload_json, '$.toolName') LIKE '%html_render'
        )
        SELECT * FROM assets
        WHERE ${input.cursor?.createdAt ?? null} IS NULL
          OR created_at < ${input.cursor?.createdAt ?? null}
          OR (created_at = ${input.cursor?.createdAt ?? null} AND key < ${input.cursor?.key ?? null})
        ORDER BY created_at DESC, key DESC LIMIT ${limit + 1}
      `;
      const scanned = rows.slice(0, limit);
      const items: Array<BotFile> = [];
      for (const row of scanned) {
        const source = {
          id: row.key,
          createdAt: row.created_at,
          sourceThreadId: ThreadId.make(row.thread_id),
          sourceMessageId: row.message_id === null ? null : MessageId.make(row.message_id),
          sourceTurnItemId: row.item_id === null ? null : TurnItemId.make(row.item_id),
        };
        if (row.message_id !== null) {
          const attachment = yield* decodeAttachment(row.payload);
          // Snapshot accessibility data is useful in the conversation, not a file-list payload.
          const { source: _source, ...metadata } = attachment as ChatAttachment & {
            source?: unknown;
          };
          items.push({
            ...source,
            kind: "attachment",
            title: attachment.name,
            attachment: metadata,
          });
        } else {
          const output = yield* decodeHtmlOutput(row.payload);
          const htmlRender = htmlRenderFromToolItem(output);
          if (htmlRender === undefined) continue;
          const item = decodeFile({
            ...source,
            kind: "html",
            title: htmlRender.title,
            htmlRender,
          });
          if (Option.isSome(item)) items.push(item.value);
        }
      }
      const last = scanned.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last !== undefined
            ? { createdAt: last.created_at, key: last.key }
            : null,
      };
    },
    (effect, input) => effect.pipe(Effect.mapError(failure("read-files", input.projectId))),
  );

  const setAvatar = Effect.fn("BotService.setAvatar")(function* (input: BotSetAvatarInput) {
    const project = yield* readBot(input.projectId);
    const faviconPath = yield* workspace
      .writeAvatar(project.workspaceRoot, input.image)
      .pipe(Effect.mapError(failure("save-avatar", project.id)));
    return yield* projects
      .update({
        commandId: input.commandId,
        projectId: project.id,
        projectIcon: null,
        faviconPath,
      })
      .pipe(Effect.mapError(failure("save-avatar", project.id)));
  });

  return BotService.of({ open, create, files, setAvatar });
});

export const layer = Layer.effect(BotService, make);
