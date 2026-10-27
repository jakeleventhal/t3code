import * as Schema from "effect/Schema";

import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Generated avatar assets live under the bot workspace's `.avatars` folder, named by content
 * digest so every environment that holds a copy agrees on the path, and clients can cache by it.
 */
export const BotAvatarAssetPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^\.avatars\/[a-f0-9]{64}\.(?:png|jpe?g|webp|mp4)$/i),
);
export type BotAvatarAssetPath = typeof BotAvatarAssetPath.Type;

export const BOT_AVATAR_CLIP_KINDS = ["idle", "working", "call"] as const;
export const BotAvatarClipKind = Schema.Literals(BOT_AVATAR_CLIP_KINDS);
export type BotAvatarClipKind = typeof BotAvatarClipKind.Type;

export const BOT_AVATAR_PROMPT_MAX_LENGTH = 600;
export const BotAvatarPrompt = TrimmedNonEmptyString.check(
  Schema.isMaxLength(BOT_AVATAR_PROMPT_MAX_LENGTH),
);

export const BotAvatarJobStatus = Schema.Literals([
  "generating-options",
  "awaiting-selection",
  "animating",
  "generating-image",
  "failed",
]);
export type BotAvatarJobStatus = typeof BotAvatarJobStatus.Type;

/** The in-progress or failed step of an avatar change; null once the change is complete. */
export const BotAvatarJob = Schema.Struct({
  /** Only this environment owns the running generation; replicas display its progress. */
  originEnvironmentId: Schema.optional(EnvironmentId),
  kind: Schema.Literals(["live", "image"]),
  status: BotAvatarJobStatus,
  prompt: BotAvatarPrompt,
  candidates: Schema.optional(Schema.Array(BotAvatarAssetPath).check(Schema.isMaxLength(4))),
  /** Which step failed, so Retry resumes there instead of starting over. */
  failedStep: Schema.optional(Schema.Literals(["options", "animation", "image"])),
  error: Schema.optional(Schema.String.check(Schema.isMaxLength(600))),
  startedAt: IsoDateTime,
});
export type BotAvatarJob = typeof BotAvatarJob.Type;

export const BotAvatarClips = Schema.Struct({
  idle: Schema.optional(BotAvatarAssetPath),
  working: Schema.optional(BotAvatarAssetPath),
  call: Schema.optional(BotAvatarAssetPath),
});
export type BotAvatarClips = typeof BotAvatarClips.Type;

/**
 * A bot's generated avatar: silent clips for each activity state plus the step still in flight.
 * The still itself is the project's `faviconPath`, so every existing photo surface keeps working.
 * `version` changes with every new choice; a job result carrying an older version is discarded.
 */
export const BotAvatar = Schema.Struct({
  version: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  clips: BotAvatarClips,
  job: Schema.NullOr(BotAvatarJob),
  updatedAt: IsoDateTime,
});
export type BotAvatar = typeof BotAvatar.Type;

const BotAvatarProviderCapability = Schema.Struct({
  available: Schema.Boolean,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  providerName: Schema.optional(TrimmedNonEmptyString),
  /** Why it is unavailable, in words the editor can show beside the disabled choice. */
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
});
export const BotAvatarCapabilities = Schema.Struct({
  liveAnimation: BotAvatarProviderCapability,
  image: BotAvatarProviderCapability,
});
export type BotAvatarCapabilities = typeof BotAvatarCapabilities.Type;

export const BotAvatarGenerateOptionsInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  prompt: BotAvatarPrompt,
});
export type BotAvatarGenerateOptionsInput = typeof BotAvatarGenerateOptionsInput.Type;

export const BotAvatarSelectOptionInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  version: TrimmedNonEmptyString,
  candidate: BotAvatarAssetPath,
});
export type BotAvatarSelectOptionInput = typeof BotAvatarSelectOptionInput.Type;

export const BotAvatarDescribeImageInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  prompt: BotAvatarPrompt,
});
export type BotAvatarDescribeImageInput = typeof BotAvatarDescribeImageInput.Type;

export const BotAvatarRetryInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  version: TrimmedNonEmptyString,
});
export type BotAvatarRetryInput = typeof BotAvatarRetryInput.Type;

export const BotAvatarDismissInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
});
export type BotAvatarDismissInput = typeof BotAvatarDismissInput.Type;

export const BOT_AVATAR_ASSET_MAX_BYTES = 3 * 1024 * 1024;
export const BotAvatarAssetReadInput = Schema.Struct({
  projectId: ProjectId,
  path: BotAvatarAssetPath,
});
export type BotAvatarAssetReadInput = typeof BotAvatarAssetReadInput.Type;
export const BotAvatarAssetTransfer = Schema.Struct({
  projectId: ProjectId,
  path: BotAvatarAssetPath,
  base64: Schema.String.check(
    Schema.isMaxLength(Math.ceil((BOT_AVATAR_ASSET_MAX_BYTES * 4) / 3) + 8),
  ),
});
export type BotAvatarAssetTransfer = typeof BotAvatarAssetTransfer.Type;

export const BotAvatarErrorReason = Schema.Literals([
  "provider-unavailable",
  "provider-refused",
  "quota",
  "privacy",
  "generation-failed",
  "stale",
  "invalid-selection",
  "not-found",
  "asset-invalid",
  "storage",
]);
export type BotAvatarErrorReason = typeof BotAvatarErrorReason.Type;

export class BotAvatarError extends Schema.TaggedError<BotAvatarError>()("BotAvatarError", {
  reason: BotAvatarErrorReason,
  projectId: Schema.optional(ProjectId),
  /** The provider's own refusal, when it says something a user can act on. */
  providerMessage: Schema.optional(Schema.String.check(Schema.isMaxLength(600))),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return botAvatarErrorMessage(this.reason, this.providerMessage);
  }
}

export function botAvatarErrorMessage(
  reason: BotAvatarErrorReason,
  providerMessage?: string,
): string {
  switch (reason) {
    case "provider-unavailable":
      return "No connected provider can generate this avatar right now.";
    case "provider-refused":
      return providerMessage ?? "The provider declined to generate this avatar.";
    case "quota":
      return (
        providerMessage ??
        "The provider has no generation credits left. Add credits or upgrade, then retry."
      );
    case "privacy":
      return (
        providerMessage ??
        "The provider's privacy settings block image and video generation on this account. Allow it in the provider's data settings, then retry."
      );
    case "generation-failed":
      return providerMessage ?? "The avatar could not be generated. Try again.";
    case "stale":
      return "A newer avatar choice replaced this one.";
    case "invalid-selection":
      return "That option is no longer available.";
    case "not-found":
      return "The bot was not found.";
    case "asset-invalid":
      return "The avatar file is not a usable image or clip.";
    case "storage":
      return "The avatar could not be saved on this machine.";
  }
}
