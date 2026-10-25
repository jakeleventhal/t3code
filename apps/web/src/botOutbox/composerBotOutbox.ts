import type {
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationMessageContext,
  ThreadId,
} from "@t3tools/contracts";

import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerThreadDraftState,
} from "../composerDraftStore";
import { readAttachmentUpload } from "../lib/attachmentUploadQueue";
import { createBotOutboxItem } from "./botOutbox";
import type { BotOutboxAttachment, BotOutboxItem } from "./botOutbox.logic";

/**
 * A bot chat composer's message as an unsent outbox entry. Attachment bytes are kept so they can
 * upload once the host is back; an upload this host already holds is reused instead.
 */
export function composerBotOutboxItem(input: {
  readonly messageId: MessageId;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly context: OrchestrationMessageContext | undefined;
  readonly attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
  readonly sent?: { readonly commandId: CommandId; readonly createdAt: string };
}): { readonly item: BotOutboxItem } | { readonly error: string } {
  const { environmentId } = input;
  const attachments: BotOutboxAttachment[] = [];
  for (const attachment of input.attachments) {
    const upload = readAttachmentUpload(attachment.id);
    const uploadedId =
      upload?.status === "ready" && upload.environmentId === environmentId
        ? upload.attachmentId
        : attachment.type === "file" && attachment.uploadEnvironmentId === environmentId
          ? attachment.uploadedAttachmentId
          : undefined;
    if (attachment.file === null && uploadedId === undefined) {
      return { error: `Attach '${attachment.name}' again before sending.` };
    }
    const base = {
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      file: attachment.file,
      ...(uploadedId === undefined
        ? {}
        : { uploaded: { environmentId, attachmentId: uploadedId } }),
    };
    attachments.push(
      attachment.type === "image"
        ? { ...base, type: "image", ...(attachment.source ? { source: attachment.source } : {}) }
        : { ...base, type: "file", ...(attachment.source ? { source: attachment.source } : {}) },
    );
  }
  return {
    item: createBotOutboxItem({
      messageId: input.messageId,
      environmentId,
      threadId: input.threadId,
      text: input.text,
      ...(input.context ? { context: input.context } : {}),
      attachments,
      ...(input.sent ? { sent: input.sent } : {}),
    }),
  };
}

/**
 * Whether the composer still holds what was queued. Uploads and settings rewrite the draft
 * object, so this compares what the user wrote.
 */
export function composerDraftUnchangedSinceQueue(
  before: ComposerThreadDraftState | null,
  after: ComposerThreadDraftState | null,
): boolean {
  if (before === null || after === null) return before === after;
  const ids = (draft: ComposerThreadDraftState) =>
    [...draft.images, ...draft.files].map((attachment) => attachment.id).join("\n");
  return (
    before.prompt === after.prompt &&
    ids(before) === ids(after) &&
    before.threadContexts.length === after.threadContexts.length &&
    before.terminalContexts.length === after.terminalContexts.length &&
    before.previewAnnotations.length === after.previewAnnotations.length &&
    before.reviewComments.length === after.reviewComments.length
  );
}
