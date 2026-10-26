import { isSubscriptionVoiceSupported } from "./VoiceConfiguration.ts";
import { initialBotDefaults } from "./botDefaultSelections.ts";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import {
  BotId,
  BotReplicaManifest,
  BotReplicationError,
  BotReplicaCursor,
  BotSharedPreferences,
  type BotPreferencesChange,
  type ServerProvider,
  type BotReplicaReadInput,
  type BotReplicaPage,
  type BotReplicationStatus,
  CommandId,
  EventId,
  TurnItemId,
  OrchestrationV2AppThread,
  OrchestrationV2ConversationMessage,
  OrchestrationV2AppThreadJson,
  OrchestrationV2TurnItemJson,
  OrchestrationV2ConversationMessageJson,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectService from "../project/ProjectService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Files from "./BotContinuityFiles.ts";

const readMessage = Schema.decodeSync(
  Schema.fromJsonString(OrchestrationV2ConversationMessageJson),
);
const readCall = Schema.decodeSync(Schema.fromJsonString(OrchestrationV2TurnItemJson.members[0]));
const readThread = Schema.decodeSync(Schema.fromJsonString(OrchestrationV2AppThreadJson));
const readCursor = Schema.decodeSync(Schema.fromJsonString(BotReplicaCursor));
const writeCursor = Schema.encodeSync(Schema.fromJsonString(BotReplicaCursor));
const writeManifest = Schema.encodeEffect(Schema.fromJsonString(BotReplicaManifest));

export class BotReplication extends Context.Service<
  BotReplication,
  {
    readonly initializeDefaults: (
      providers: readonly ServerProvider[],
    ) => Effect.Effect<void, BotReplicationError>;
    readonly status: Effect.Effect<BotReplicationStatus, BotReplicationError>;
    readonly read: (
      input: BotReplicaReadInput,
    ) => Effect.Effect<BotReplicaPage, BotReplicationError>;
    readonly receive: (page: BotReplicaPage) => Effect.Effect<void, BotReplicationError>;
    readonly configure: (
      change: BotPreferencesChange,
    ) => Effect.Effect<BotSharedPreferences, BotReplicationError>;
    readonly mergePreferences: (
      preferences: BotSharedPreferences,
    ) => Effect.Effect<void, BotReplicationError>;
  }
>()("t3/bots/BotReplication") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectService.ProjectService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const sink = yield* EventSink.EventSinkV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const lock = yield* Semaphore.make(1);
  const fail = (operation: BotReplicationError["operation"]) => (cause: unknown) =>
    new BotReplicationError({ operation, cause });

  const status = Effect.gen(function* () {
    const snapshot = yield* projects.snapshot;
    const sources = yield* sql<{
      project_id: ProjectId;
      environment_id: string;
      cursor_json: string | null;
      manifest_digest: string | null;
      ready: number;
    }>`SELECT * FROM bot_replica_sources`;
    return {
      preferences: (yield* settings.getSettings).botSharedPreferences,
      projects: snapshot.projects
        .filter((project) => project.botRole != null && project.deletedAt === null)
        .map((project) => ({
          projectId: project.id,
          ready: !sources.some((source) => source.project_id === project.id && !source.ready),
        })),
      cursors: sources.map((source) => ({
        environmentId: source.environment_id as BotReplicaPage["environmentId"],
        projectId: source.project_id,
        cursor: source.cursor_json === null ? null : readCursor(source.cursor_json),
        manifestDigest: source.manifest_digest,
      })),
    };
  }).pipe(Effect.mapError(fail("read")));

  const read = Effect.fn("BotReplication.read")(
    function* (input: BotReplicaReadInput) {
      const environmentId = yield* identity.getEnvironmentId;
      const project = Option.getOrNull(yield* projects.getById(input.projectId));
      if (project?.botRole == null) return yield* fail("read")("Not a bot project");
      const rows = yield* sql<{ payload_json: string; sequence: number; kind: "message" | "call" }>`
      SELECT COALESCE(m.payload_json, i.payload_json) AS payload_json, c.sequence,
        CASE WHEN c.message_id IS NULL THEN 'call' ELSE 'message' END AS kind
      FROM bot_replica_changes c
      LEFT JOIN orchestration_v2_projection_messages m ON m.message_id = c.message_id
      LEFT JOIN orchestration_v2_projection_turn_items i ON i.turn_item_id = c.turn_item_id
      JOIN orchestration_v2_projection_threads t ON t.thread_id = COALESCE(m.thread_id, i.thread_id)
      WHERE t.project_id = ${project.id} AND (m.streaming = 0 OR i.type = 'voice_call')
        AND c.sequence > ${input.after?.sequence ?? 0}
      ORDER BY c.sequence LIMIT 65
    `;
      // Bound each transfer by bytes as well as message count. Attachments are references only.
      const selected: (typeof rows)[number][] = [];
      let bytes = 0;
      for (const row of rows.slice(0, 64)) {
        bytes += row.payload_json.length;
        if (bytes > 2 * 1024 * 1024 && selected.length > 0) break;
        selected.push(row);
      }
      const last = selected.at(-1);
      const threadRows = input.includeManifest
        ? yield* sql<{ payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_threads
      WHERE project_id = ${project.id} ORDER BY created_at, thread_id LIMIT 1001
    `
        : [];
      if (threadRows.length > 1000) return yield* fail("read")("Bot thread limit exceeded");
      const manifest = input.includeManifest
        ? {
            environmentId,
            project: {
              id: project.id,
              title: project.title,
              projectIcon: project.projectIcon ?? null,
              botRole: project.botRole,
              botMainThreadId: project.botMainThreadId ?? null,
              createdAt: project.createdAt,
            },
            threads: threadRows.map((row) => readThread(row.payload_json)),
            files: yield* Files.capture({
              botId: BotId.make(project.id),
              environmentId,
              workspaceRoot: project.workspaceRoot,
            }),
          }
        : null;
      const manifestDigest =
        manifest === null
          ? null
          : yield* crypto
              .digest("SHA-256", new TextEncoder().encode(yield* writeManifest(manifest)))
              .pipe(Effect.map(Hex.encode));
      const versions =
        manifestDigest === null
          ? []
          : yield* sql<{ revision: number }>`
      INSERT INTO bot_replica_manifests(project_id, digest, revision)
      VALUES (${project.id}, ${manifestDigest}, 1)
      ON CONFLICT(project_id) DO UPDATE SET digest = excluded.digest,
        revision = bot_replica_manifests.revision + (bot_replica_manifests.digest != excluded.digest)
      RETURNING revision
    `;
      return {
        environmentId,
        projectId: project.id,
        after: input.after ?? null,
        manifestRevision: versions[0]?.revision ?? null,
        manifest: manifestDigest === input.knownManifestDigest ? null : manifest,
        manifestDigest,
        calls: selected
          .filter((row) => row.kind === "call")
          .map((row) => {
            const {
              voiceOwner: _owner,
              voiceWriters: _writers,
              ...call
            } = readCall(row.payload_json);
            return call;
          }),
        messages: selected
          .filter((row) => row.kind === "message")
          .map((row) => {
            const message = readMessage(row.payload_json);
            return {
              ...message,
              attachments: message.attachments.map((attachment) => ({
                ...attachment,
                originEnvironmentId: attachment.originEnvironmentId ?? environmentId,
              })),
            };
          }),
        cursor: last ? { sequence: last.sequence } : (input.after ?? null),
        complete: rows.length === selected.length,
      } satisfies BotReplicaPage;
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(fail("read")),
  );

  const receive = Effect.fn("BotReplication.receive")(
    function* (page: BotReplicaPage) {
      const environmentId = yield* identity.getEnvironmentId;
      if (page.environmentId === environmentId) return;
      // Acquire SQLite's writer before checking active work. A new run cannot commit and
      // start its provider midway through applying this workspace snapshot.
      yield* sql`UPDATE bot_replica_sources SET ready = ready WHERE project_id = ${page.projectId}`;
      let project = Option.getOrNull(
        yield* projects.getById(page.projectId, { includeDeleted: true }),
      );
      if (project?.deletedAt != null) return;
      if (project !== null && project.botRole == null)
        return yield* fail("receive")("Project collision");
      const prior = (yield* sql<{
        cursor_json: string | null;
        manifest_revision: number;
        ready: number;
      }>`
      SELECT cursor_json, manifest_revision, ready FROM bot_replica_sources
      WHERE project_id = ${page.projectId} AND environment_id = ${page.environmentId}
    `)[0];
      const previousSequence = prior?.cursor_json ? readCursor(prior.cursor_json).sequence : 0;
      if ((page.after?.sequence ?? 0) > previousSequence)
        return yield* fail("receive")("Missing earlier history page");
      if ((page.cursor?.sequence ?? 0) < previousSequence) return;
      if (page.manifest !== null && page.manifestRevision === null)
        return yield* fail("receive")("Missing manifest revision");
      const manifest =
        (page.manifestRevision ?? 0) > (prior?.manifest_revision ?? 0) ? page.manifest : null;
      // A running provider owns its workspace. Retry this page after its turn finishes.
      const active = yield* sql`SELECT 1 FROM orchestration_v2_projection_runs r
      JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
      WHERE t.project_id = ${page.projectId}
        AND r.status IN ('queued','preparing','starting','running','waiting') LIMIT 1`;
      if (active.length > 0) return yield* fail("receive")("Bot is currently running");
      if (manifest !== null) {
        if (
          manifest.project.id !== page.projectId ||
          manifest.environmentId !== page.environmentId ||
          String(manifest.files.botId) !== page.projectId
        )
          return yield* fail("receive")("Mismatched bot manifest");
        yield* sql`INSERT INTO bot_replica_sources(project_id, environment_id, origin_created_at, ready)
        VALUES (${page.projectId}, ${page.environmentId}, ${manifest.project.createdAt}, 0) ON CONFLICT DO NOTHING`;
        if (project === null) {
          const workspaceRoot = yield* folders.prepareBotWorkspace(page.projectId);
          project = yield* projects.create({
            commandId: CommandId.make(`bot-replica:${page.projectId}`),
            projectId: page.projectId,
            title: manifest.project.title,
            botRole: manifest.project.botRole,
            workspaceRoot,
          });
          {
            project = yield* projects.update({
              commandId: CommandId.make(`bot-replica-main:${page.projectId}`),
              projectId: page.projectId,
              botMainThreadId: manifest.project.botMainThreadId,
              projectIcon: manifest.project.projectIcon,
            });
          }
        }

        const base = yield* sql<{
          path: string;
          text: string;
        }>`SELECT path, text FROM bot_replica_files WHERE project_id = ${page.projectId} AND environment_id = ${page.environmentId}`;
        const { applied, removed } = yield* Files.reconcile(
          project.workspaceRoot,
          manifest.files,
          base,
        );
        for (const file of applied)
          yield* sql`INSERT INTO bot_replica_files(project_id, environment_id, path, text)
        VALUES (${page.projectId}, ${page.environmentId}, ${file.path}, ${file.text})
        ON CONFLICT(project_id, environment_id, path) DO UPDATE SET text = excluded.text`;
        for (const path of removed)
          yield* sql`DELETE FROM bot_replica_files WHERE project_id = ${page.projectId} AND environment_id = ${page.environmentId} AND path = ${path}`;
        for (const source of manifest.threads) {
          if (source.projectId !== project.id)
            return yield* fail("receive")("Thread belongs to another project");
          const existing = yield* projections
            .getThread(source.id)
            .pipe(
              Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }),
            );
          if (existing !== null) {
            if (existing.projectId !== project.id)
              return yield* fail("receive")("Thread collision");
            if (
              DateTime.toEpochMillis(source.updatedAt) > DateTime.toEpochMillis(existing.updatedAt)
            ) {
              yield* sink.write({
                events: [
                  {
                    id: EventId.make(
                      `bot-replica:metadata:${page.environmentId}:${source.id}:${page.manifestRevision}`,
                    ),
                    type: "thread.metadata-updated",
                    threadId: source.id,
                    occurredAt: source.updatedAt,
                    payload: {
                      ...existing,
                      title: source.title,
                      archivedAt: source.archivedAt,
                      deletedAt: source.deletedAt,
                      updatedAt: source.updatedAt,
                    },
                  },
                ],
              });
            }
            continue;
          }
          // A replica contains conversation history, never executable native sessions or work.
          const thread: OrchestrationV2AppThread = {
            createdBy: "system",
            creationSource: "server",
            id: source.id,
            projectId: project.id,
            title: source.title,
            providerInstanceId: source.providerInstanceId,
            modelSelection: source.modelSelection,
            runtimeMode: source.runtimeMode,
            interactionMode: source.interactionMode,
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            historyOrigin: "bot_replica",
            replicaEnvironmentId: environmentId,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: source.id },
            forkedFrom: null,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            archivedAt: source.archivedAt,
            settledAt: null,
            settledOverride: null,
            lastVisitedAt: null,
            deletedAt: source.deletedAt,
          };
          yield* sink.write({
            events: [
              {
                id: EventId.make(`bot-replica:thread:${thread.id}`),
                type: "thread.created",
                threadId: thread.id,
                occurredAt: source.createdAt,
                payload: thread,
              },
            ],
          });
        }
      }
      if (project === null) return yield* fail("receive")("Missing bot manifest");
      const wasReady = project.botReplicaReady !== false;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const source of page.messages) {
            const thread = yield* projections.getThread(source.threadId);
            if (thread.projectId !== page.projectId)
              return yield* fail("receive")("Message belongs to another bot");
            const found = yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM orchestration_v2_projection_messages WHERE message_id = ${source.id}`;
            if (found.length > 0) {
              const previous = readMessage(found[0]!.payload_json);
              if (previous.threadId !== source.threadId)
                return yield* fail("receive")("Message collision");
              const imported =
                yield* sql`SELECT 1 FROM bot_replica_messages WHERE message_id = ${source.id}`;
              if (
                imported.length === 0 ||
                DateTime.toEpochMillis(source.updatedAt) <
                  DateTime.toEpochMillis(previous.updatedAt) ||
                (DateTime.toEpochMillis(source.updatedAt) ===
                  DateTime.toEpochMillis(previous.updatedAt) &&
                  !(source.voiceCall && !previous.voiceCall))
              )
                continue;
            }
            const message: OrchestrationV2ConversationMessage = {
              createdBy: source.createdBy,
              creationSource: "server",
              id: source.id,
              threadId: source.threadId,
              runId: null,
              nodeId: null,
              role: source.role,
              text: source.text,
              attachments: source.attachments,
              streaming: false,
              ...(source.context ? { context: source.context } : {}),
              ...(source.voiceCall ? { voiceCall: source.voiceCall } : {}),
              createdAt: source.createdAt,
              updatedAt: source.updatedAt,
            };
            const itemId = TurnItemId.make(`bot-replica:${source.id}`);
            const position = yield* sql<{ ordinal: number }>`SELECT COALESCE(
          (SELECT ordinal FROM orchestration_v2_turn_item_positions WHERE thread_id = ${source.threadId} AND turn_item_id = ${itemId}),
          (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM orchestration_v2_turn_item_positions WHERE thread_id = ${source.threadId})
        ) AS ordinal`;
            const base = {
              id: itemId,
              threadId: source.threadId,
              runId: null,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: position[0]!.ordinal,
              status: "completed" as const,
              title: null,
              startedAt: source.createdAt,
              completedAt: source.updatedAt,
              updatedAt: source.updatedAt,
            };
            const item: OrchestrationV2TurnItem =
              source.role === "user"
                ? {
                    ...base,
                    createdBy: "user",
                    creationSource: "server",
                    type: "user_message",
                    messageId: source.id,
                    inputIntent: "turn_start",
                    text: source.text,
                    attachments: source.attachments,
                  }
                : {
                    ...base,
                    type: "assistant_message",
                    messageId: source.id,
                    text: source.text,
                    streaming: false,
                  };
            const events: OrchestrationV2DomainEvent[] = [
              {
                id: EventId.make(
                  `bot-replica:message:${source.id}:${DateTime.formatIso(source.updatedAt)}${source.voiceCall ? ":voice" : ""}`,
                ),
                type: "message.updated",
                threadId: source.threadId,
                occurredAt: source.updatedAt,
                payload: message,
              },
              {
                id: EventId.make(
                  `bot-replica:item:${source.id}:${DateTime.formatIso(source.updatedAt)}`,
                ),
                type: "turn-item.updated",
                threadId: source.threadId,
                occurredAt: source.updatedAt,
                payload: item,
              },
            ];
            yield* sql`INSERT INTO orchestration_v2_turn_item_positions(thread_id, turn_item_id, ordinal)
          VALUES (${source.threadId}, ${itemId}, ${base.ordinal}) ON CONFLICT DO NOTHING`;
            yield* sink.write({
              events: source.role === "system" || source.voiceCall ? events.slice(0, 1) : events,
            });
            yield* sql`INSERT INTO bot_replica_messages(message_id, source_environment_id)
          VALUES (${source.id}, ${page.environmentId}) ON CONFLICT DO NOTHING`;
          }
          for (const source of page.calls ?? []) {
            const thread = yield* projections.getThread(source.threadId);
            if (
              thread.projectId !== page.projectId ||
              source.status === "running" ||
              source.call.endedAt === null
            )
              return yield* fail("receive")("Invalid replicated call");
            const found = yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE turn_item_id = ${source.id}`;
            if (found.length > 0) {
              const previous = readCall(found[0]!.payload_json);
              if (previous.threadId !== source.threadId)
                return yield* fail("receive")("Call collision");
              if (
                DateTime.toEpochMillis(previous.updatedAt) >=
                DateTime.toEpochMillis(source.updatedAt)
              )
                continue;
            }
            const position = yield* sql<{ ordinal: number }>`SELECT COALESCE(
              (SELECT ordinal FROM orchestration_v2_turn_item_positions WHERE thread_id = ${source.threadId} AND turn_item_id = ${source.id}),
              (SELECT MIN(p.ordinal) FROM orchestration_v2_turn_item_positions p
                JOIN orchestration_v2_projection_messages m ON p.turn_item_id = 'bot-replica:' || m.message_id
                WHERE p.thread_id = ${source.threadId}
                  AND json_extract(m.payload_json, '$.voiceCall.callId') = ${source.call.callId}),
              (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM orchestration_v2_turn_item_positions WHERE thread_id = ${source.threadId})
            ) AS ordinal`;
            const { voiceOwner: _owner, voiceWriters: _writers, ...rest } = source;
            const item = { ...rest, runId: null, nodeId: null, ordinal: position[0]!.ordinal };
            // A repaired call takes the transcript's original slot, before any later text replies.
            yield* sql`DELETE FROM orchestration_v2_turn_item_positions
              WHERE thread_id = ${source.threadId} AND ordinal = ${item.ordinal} AND turn_item_id != ${source.id}`;
            yield* sql`INSERT INTO orchestration_v2_turn_item_positions(thread_id, turn_item_id, ordinal)
              VALUES (${source.threadId}, ${source.id}, ${item.ordinal}) ON CONFLICT DO NOTHING`;
            yield* sink.write({
              events: [
                {
                  id: EventId.make(
                    `bot-replica:call:${source.id}:${DateTime.formatIso(source.updatedAt)}`,
                  ),
                  type: "turn-item.updated",
                  threadId: source.threadId,
                  occurredAt: source.updatedAt,
                  payload: item,
                },
              ],
            });
          }
          yield* sql`INSERT INTO bot_replica_sources(project_id, environment_id, cursor_json, manifest_digest, manifest_revision, ready)
        VALUES (${page.projectId}, ${page.environmentId}, ${page.cursor === null ? null : writeCursor(page.cursor)}, ${manifest === null ? null : page.manifestDigest}, ${manifest === null ? (prior?.manifest_revision ?? 0) : page.manifestRevision}, ${page.complete || (prior?.ready === 1 && (page.cursor?.sequence ?? 0) === previousSequence) ? 1 : 0})
        ON CONFLICT(project_id, environment_id) DO UPDATE SET cursor_json = excluded.cursor_json, manifest_digest = COALESCE(excluded.manifest_digest, bot_replica_sources.manifest_digest), manifest_revision = MAX(bot_replica_sources.manifest_revision, excluded.manifest_revision), ready = excluded.ready`;
        }),
      );
      if (wasReady !== page.complete) {
        yield* projects.update({
          commandId: CommandId.make(
            `bot-replica-state:${page.projectId}:${page.environmentId}:${page.cursor?.sequence ?? 0}:${page.complete}`,
          ),
          projectId: project.id,
          title: project.title,
        });
      }
    },
    (effect) => lock.withPermits(1)(sql.withTransaction(effect)),
    Effect.mapError(fail("receive")),
  );

  const savePreferences = Effect.fn("BotReplication.savePreferences")(function* (
    value: BotSharedPreferences,
  ) {
    const current = yield* settings.getSettings;
    const projectSettingsOverrides = { ...current.projectSettingsOverrides };
    for (const [rawId, override] of Object.entries(value.runtimeOverrides ?? {})) {
      const id = ProjectId.make(rawId);
      const next = { ...projectSettingsOverrides[id] };
      if (override.modelSelection !== undefined) {
        if (override.modelSelection === null) delete next.defaultModelSelection;
        else next.defaultModelSelection = override.modelSelection;
      }
      if (override.runtimeMode !== undefined) {
        if (override.runtimeMode === null) delete next.defaultRuntimeMode;
        else next.defaultRuntimeMode = override.runtimeMode;
      }
      projectSettingsOverrides[id] = next;
    }
    yield* settings.updateSettings({
      projectSettingsOverrides,
      botSharedPreferences: value,
      defaultBotEnvironmentId: value.primaryEnvironmentId,
      botDefaults: {
        defaultModelSelection: value.defaultModelSelection,
        defaultRuntimeMode: value.defaultRuntimeMode,
      },
    });
  });
  const configure = Effect.fn("BotReplication.configure")(
    function* (requested: BotPreferencesChange, initialize = false) {
      const saved = yield* settings.getSettings;
      const current =
        saved.botSharedPreferences.revision === 0
          ? {
              ...saved.botSharedPreferences,
              ...saved.botDefaults,
              primaryEnvironmentId: saved.defaultBotEnvironmentId,
            }
          : saved.botSharedPreferences;
      const previousVoice =
        current.defaultVoice === undefined ? saved.voiceSelection : current.defaultVoice;
      const previousVoiceKind =
        current.defaultVoice?.connectionKind ??
        (previousVoice ? saved.voiceConnections[previousVoice.connectionId]?.kind : undefined);
      const missingVoice = current.defaultVoice === undefined && saved.voiceSelection === null;
      const retiredVoice =
        previousVoice != null &&
        previousVoiceKind === "codex-subscription" &&
        !isSubscriptionVoiceSupported(previousVoice);
      const change = initialize
        ? {
            ...(current.defaultModelSelection == null && requested.defaultModelSelection
              ? { defaultModelSelection: requested.defaultModelSelection }
              : {}),
            ...(current.complexTaskModelSelection == null && requested.complexTaskModelSelection
              ? { complexTaskModelSelection: requested.complexTaskModelSelection }
              : {}),
            ...(current.defaultRuntimeMode == null
              ? { defaultRuntimeMode: saved.defaultRuntimeMode }
              : {}),
            ...((missingVoice || retiredVoice) && requested.defaultVoiceSelection
              ? { defaultVoiceSelection: requested.defaultVoiceSelection }
              : {}),
          }
        : requested;
      if (initialize && Object.keys(change).length === 0) return current;
      const overrides = { ...current.overrides };
      if (change.override) {
        if (change.override.environmentId === null) delete overrides[change.override.projectId];
        else overrides[change.override.projectId] = change.override.environmentId;
      }
      const complexTaskModelOverrides = { ...current.complexTaskModelOverrides };
      if (change.complexTaskModelOverride) {
        const { projectId, selection } = change.complexTaskModelOverride;
        if (selection === null) delete complexTaskModelOverrides[projectId];
        else complexTaskModelOverrides[projectId] = selection;
      }
      const shareVoice = (
        selection: NonNullable<BotPreferencesChange["defaultVoiceSelection"]>,
      ) => {
        const connection = saved.voiceConnections[selection.connectionId];
        if (!connection) return null;
        return { ...selection, connectionKind: connection.kind };
      };
      if (change.defaultVoiceSelection && !shareVoice(change.defaultVoiceSelection))
        return yield* fail("settings")("The selected voice account is unavailable.");
      const voiceOverrides = { ...current.voiceOverrides };
      if (change.voiceOverride) {
        const { projectId, selection } = change.voiceOverride;
        const shared =
          typeof selection === "object" && selection !== null ? shareVoice(selection) : selection;
        if (selection !== null && selection !== "inherit" && shared === null)
          return yield* fail("settings")("The selected voice account is unavailable.");
        voiceOverrides[projectId] = shared;
      }
      const runtimeOverrides = { ...current.runtimeOverrides };
      if (change.runtimeOverride) {
        const { projectId, ...override } = change.runtimeOverride;
        runtimeOverrides[projectId] = { ...runtimeOverrides[projectId], ...override };
      }
      const value = {
        ...current,
        runtimeOverrides,
        complexTaskModelOverrides,
        voiceOverrides,
        ...(change.defaultVoiceSelection === undefined
          ? {}
          : {
              defaultVoice:
                change.defaultVoiceSelection === null
                  ? null
                  : shareVoice(change.defaultVoiceSelection),
            }),
        ...(change.complexTaskModelSelection === undefined
          ? {}
          : {
              complexTaskModelSelection: change.complexTaskModelSelection,
            }),
        revision: current.revision + 1,
        author: yield* identity.getEnvironmentId,
        primaryEnvironmentId:
          change.primaryEnvironmentId === undefined
            ? current.primaryEnvironmentId
            : change.primaryEnvironmentId,
        defaultModelSelection:
          change.defaultModelSelection === undefined
            ? current.defaultModelSelection
            : change.defaultModelSelection,
        defaultRuntimeMode:
          change.defaultRuntimeMode === undefined
            ? current.defaultRuntimeMode
            : change.defaultRuntimeMode,
        overrides,
      };
      yield* savePreferences(value);
      return value;
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(fail("settings")),
  );
  const mergePreferences = Effect.fn("BotReplication.mergePreferences")(
    function* (value: BotSharedPreferences) {
      const current = (yield* settings.getSettings).botSharedPreferences;
      if (
        value.revision > current.revision ||
        (value.revision === current.revision && (value.author ?? "") > (current.author ?? ""))
      )
        yield* savePreferences(value);
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(fail("settings")),
  );
  const initializeDefaults = Effect.fn("BotReplication.initializeDefaults")(
    function* (providers: readonly ServerProvider[]) {
      const current = yield* settings.getSettings;
      yield* configure(initialBotDefaults(current, providers), true);
    },
    Effect.mapError(fail("settings")),
  );
  return BotReplication.of({
    status,
    read,
    receive,
    configure,
    mergePreferences,
    initializeDefaults,
  });
});
export const layer = Layer.effect(BotReplication, make);
