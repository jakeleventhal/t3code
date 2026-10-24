import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  MessageId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnItemId,
} from "./baseSchemas.ts";
import { ChatAttachment, ChatAttachmentId } from "./chatAttachment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

const BotConversationOptions = {
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  creationSource: Schema.optional(Schema.Literals(["web", "mobile"])),
};

export const BotOpenInput = Schema.Struct({
  ...BotConversationOptions,
  projectId: Schema.optional(ProjectId),
});
export type BotOpenInput = typeof BotOpenInput.Type;

export const BotCreateInput = Schema.Struct({
  ...BotConversationOptions,
  commandId: CommandId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type BotCreateInput = typeof BotCreateInput.Type;

export const BotConversationResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
});
export type BotConversationResult = typeof BotConversationResult.Type;

export const BotFileCursor = Schema.Struct({
  createdAt: IsoDateTime,
  key: TrimmedNonEmptyString,
});
export type BotFileCursor = typeof BotFileCursor.Type;

export const BotFilesInput = Schema.Struct({
  projectId: ProjectId,
  cursor: Schema.optional(BotFileCursor),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 }))),
});
export type BotFilesInput = typeof BotFilesInput.Type;

const BotFileSource = {
  id: TrimmedNonEmptyString,
  title: Schema.String,
  createdAt: IsoDateTime,
  sourceThreadId: ThreadId,
  sourceMessageId: Schema.NullOr(MessageId),
  sourceTurnItemId: Schema.NullOr(TurnItemId),
};
export const BotFile = Schema.Union([
  Schema.Struct({
    ...BotFileSource,
    kind: Schema.Literal("attachment"),
    attachment: ChatAttachment,
  }),
  Schema.Struct({
    ...BotFileSource,
    kind: Schema.Literal("html"),
    htmlRender: Schema.Struct({
      attachmentId: ChatAttachmentId,
      title: Schema.String,
      height: Schema.Number,
      heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Number, Schema.Number]))),
    }),
  }),
]);
export type BotFile = typeof BotFile.Type;
export const BotFilesPage = Schema.Struct({
  items: Schema.Array(BotFile),
  nextCursor: Schema.NullOr(BotFileCursor),
});
export type BotFilesPage = typeof BotFilesPage.Type;

export const BOT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const BotAvatarImage = Schema.Struct({
  mimeType: Schema.Literals(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  dataUrl: Schema.String.check(Schema.isMaxLength(Math.ceil((BOT_AVATAR_MAX_BYTES * 4) / 3) + 128)),
});
export type BotAvatarImage = typeof BotAvatarImage.Type;
export const BotSetAvatarInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  image: BotAvatarImage,
});
export type BotSetAvatarInput = typeof BotSetAvatarInput.Type;

export class BotOperationError extends Schema.TaggedError<BotOperationError>()(
  "BotOperationError",
  {
    operation: Schema.Literals([
      "read-project",
      "create-project",
      "prepare-workspace",
      "open-thread",
      "read-files",
      "save-avatar",
    ]),
    projectId: Schema.optional(ProjectId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    if (this.operation === "read-files") return "Could not load this bot's files.";
    if (this.operation === "save-avatar")
      return "Could not save this bot's photo. Use a PNG, JPEG, WebP or GIF up to 2 MB.";
    return "Could not open the bot conversation.";
  }
}
