import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId, IsoDateTime, ThreadId } from "./baseSchemas.ts";
import { ProjectIconOverride } from "./project.ts";
import { BotAvatar, BotAvatarAssetPath } from "./botAvatar.ts";
import { BotContinuityFiles } from "./botContinuity.ts";
import { BotSharedPreferences } from "./botPreferences.ts";
import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2TurnItemJson,
  OrchestrationV2ConversationMessageJson,
} from "./orchestrationV2.ts";

export const BotReplicaCursor = Schema.Struct({
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type BotReplicaCursor = typeof BotReplicaCursor.Type;
export const BotReplicaManifest = Schema.Struct({
  environmentId: EnvironmentId,
  project: Schema.Struct({
    id: ProjectId,
    title: Schema.String,
    projectIcon: Schema.NullOr(ProjectIconOverride),
    // The still and clips are content-addressed files; `avatarAssets` below says which a
    // replica already holds, so the carrier copies the rest before applying this manifest.
    faviconPath: Schema.optional(Schema.NullOr(BotAvatarAssetPath)),
    botAvatar: Schema.optional(Schema.NullOr(BotAvatar)),
    botRole: Schema.Literals(["assistant", "specialist"]),
    botMainThreadId: Schema.NullOr(ThreadId),
    createdAt: IsoDateTime,
  }),
  threads: Schema.Array(OrchestrationV2AppThreadJson).check(Schema.isMaxLength(1000)),
  files: BotContinuityFiles,
});
export type BotReplicaManifest = typeof BotReplicaManifest.Type;
export const BotReplicaReadInput = Schema.Struct({
  projectId: ProjectId,
  after: Schema.optional(BotReplicaCursor),
  includeManifest: Schema.Boolean,
  knownManifestDigest: Schema.optional(Schema.String),
});
export type BotReplicaReadInput = typeof BotReplicaReadInput.Type;
export const BotReplicaPage = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  manifest: Schema.NullOr(BotReplicaManifest),
  manifestDigest: Schema.NullOr(Schema.String),
  manifestRevision: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  after: Schema.NullOr(BotReplicaCursor),
  messages: Schema.Array(OrchestrationV2ConversationMessageJson).check(Schema.isMaxLength(64)),
  calls: Schema.optional(
    Schema.Array(OrchestrationV2TurnItemJson.members[0]).check(Schema.isMaxLength(64)),
  ),
  cursor: Schema.NullOr(BotReplicaCursor),
  complete: Schema.Boolean,
});
export type BotReplicaPage = typeof BotReplicaPage.Type;
export const BotReplicationStatus = Schema.Struct({
  preferences: BotSharedPreferences,
  projects: Schema.Array(
    Schema.Struct({
      projectId: ProjectId,
      ready: Schema.Boolean,
      avatarAssets: Schema.optional(Schema.Array(BotAvatarAssetPath)),
    }),
  ),
  cursors: Schema.Array(
    Schema.Struct({
      environmentId: EnvironmentId,
      projectId: ProjectId,
      cursor: Schema.NullOr(BotReplicaCursor),
      manifestDigest: Schema.NullOr(Schema.String),
    }),
  ),
});
export type BotReplicationStatus = typeof BotReplicationStatus.Type;
export class BotReplicationError extends Schema.TaggedError<BotReplicationError>()(
  "BotReplicationError",
  {
    operation: Schema.Literals(["read", "receive", "settings"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return this.operation === "settings"
      ? "The shared bot settings could not be saved."
      : "The bot's conversation and memory could not finish syncing.";
  }
}
