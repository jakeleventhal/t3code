import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  clampFileAttachmentUploadBytes,
  deletePendingAttachmentUpload,
  fileAttachmentTooLargeMessage,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  ChatAttachmentId,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type ChatAttachment,
  type EnvironmentId,
  type ServerConfig,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  remapComposerContextAttachments,
} from "@t3tools/shared/composerContextReferences";

import { readBotSendSettings } from "../components/bots/useBotActions";
import { uploadAttachmentBytes } from "../lib/attachmentUploadQueue";
import { readFileAsDataUrl } from "../lib/imageCompression";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { attachmentEnvironment } from "../state/attachments";
import { readThreadShell } from "../state/entities";
import { environmentServerConfigsAtom } from "../state/server";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { threadEnvironment } from "../state/threads";
import {
  classifyBotOutboxFailure,
  describeBotOutboxError,
  type BotOutboxAttachment,
  type BotOutboxItem,
} from "./botOutbox.logic";
import type { BotOutboxDeliveryInput, BotOutboxDeliveryOutcome } from "./botOutboxManager";

/** A send with no answer by then is treated as "may have arrived" and retried as the same command. */
const DELIVERY_TIMEOUT_MS = 60_000;

type Prepared =
  | {
      readonly kind: "ready";
      readonly item: BotOutboxItem;
      readonly attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>;
    }
  | { readonly kind: "stop"; readonly outcome: BotOutboxDeliveryOutcome };

const rejected = (reason: string): Prepared => ({
  kind: "stop",
  outcome: { kind: "rejected", reason },
});
const retry: Prepared = { kind: "stop", outcome: { kind: "retry" } };

function uploadedChatAttachment(
  attachment: BotOutboxAttachment,
  attachmentId: string,
): ChatAttachment {
  const base = {
    id: ChatAttachmentId.make(attachmentId),
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
  return attachment.type === "image"
    ? { ...base, type: "image", ...(attachment.source ? { source: attachment.source } : {}) }
    : { ...base, type: "file", ...(attachment.source ? { source: attachment.source } : {}) };
}

async function uploadAttachment(
  environmentId: EnvironmentId,
  attachment: BotOutboxAttachment,
  file: File,
): Promise<{ readonly kind: "uploaded"; readonly attachmentId: string } | Prepared> {
  const mimeType =
    attachment.type === "file"
      ? attachment.mimeType.toLowerCase()
      : PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
          (supported) => supported === attachment.mimeType.toLowerCase(),
        );
  if (mimeType === undefined) return rejected(`'${attachment.name}' is not a supported image.`);
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: {
      ...(attachment.type === "file" ? { type: "file" as const } : {}),
      name: attachment.name,
      mimeType,
      sizeBytes: file.size,
    },
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => uploadAttachmentBytes({ url, file, mimeType, onProgress: () => {} }),
  });
  if (result.status === "uploaded") return { kind: "uploaded", attachmentId: result.attachmentId };
  if (result.attachmentId !== null) {
    deletePendingAttachmentUpload({
      registry: appAtomRegistry,
      remove: attachmentEnvironment.remove,
      environmentId,
      attachmentId: result.attachmentId,
    });
  }
  if (result.status === "cancelled" || result.step === "resolve-url") return retry;
  const refused =
    result.step === "transfer"
      ? result.error instanceof Error && result.error.message.startsWith("Upload rejected")
      : classifyBotOutboxFailure(result.error) === "rejected";
  return refused
    ? rejected(describeBotOutboxError(result.error, `'${attachment.name}' could not upload.`))
    : retry;
}

/**
 * Uploads what the host takes and inlines images for hosts that don't. Each finished upload is
 * saved, so a retry after a dropped connection doesn't upload it again.
 */
async function prepareAttachments(
  item: BotOutboxItem,
  config: ServerConfig,
  save: BotOutboxDeliveryInput["save"],
): Promise<Prepared> {
  const capabilities = config.environment.capabilities;
  const supportsUploads = capabilities.attachmentUploads === true;
  const maxFileBytes = capabilities.fileAttachments?.maxUploadBytes;
  let current = item;
  const sent: Array<ChatAttachment | UploadChatAttachment> = [];
  for (const [index, attachment] of item.attachments.entries()) {
    if (attachment.uploaded?.environmentId === item.environmentId) {
      sent.push(uploadedChatAttachment(attachment, attachment.uploaded.attachmentId));
      continue;
    }
    if (attachment.file === null) {
      return rejected(`'${attachment.name}' is no longer available. Cancel and attach it again.`);
    }
    if (attachment.type === "file") {
      if (!supportsUploads || maxFileBytes === undefined) {
        return rejected("This bot's host doesn't accept file attachments.");
      }
      const limit = clampFileAttachmentUploadBytes(maxFileBytes);
      if (attachment.sizeBytes > limit) {
        return rejected(fileAttachmentTooLargeMessage(attachment.name, limit));
      }
    }
    if (!supportsUploads && attachment.type === "image") {
      sent.push({
        type: "image",
        id: ChatAttachmentId.make(attachment.id),
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: await readFileAsDataUrl(attachment.file),
        ...(attachment.source ? { source: attachment.source } : {}),
      });
      continue;
    }
    const uploaded = await uploadAttachment(item.environmentId, attachment, attachment.file);
    if (uploaded.kind !== "uploaded") return uploaded;
    const environmentId = item.environmentId;
    current = await save({
      ...current,
      attachments: current.attachments.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? { ...candidate, uploaded: { environmentId, attachmentId: uploaded.attachmentId } }
          : candidate,
      ),
    });
    sent.push(uploadedChatAttachment(attachment, uploaded.attachmentId));
  }
  return { kind: "ready", item: current, attachments: sent };
}

function withTimeout<A>(promise: Promise<A>): Promise<A | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), DELIVERY_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Sends one queued message through the same turn command the composer uses. Model and runtime
 * resolve now, from the bot's settings, so a default changed while offline applies to this turn.
 */
export async function deliverBotOutboxItem({
  item,
  save,
  beginSend,
}: BotOutboxDeliveryInput): Promise<BotOutboxDeliveryOutcome> {
  const { environmentId, threadId } = item;
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
    return { kind: "rejected", reason: "This connection can't send messages to this bot." };
  }
  const thread = readThreadShell(scopeThreadRef(environmentId, threadId));
  if (thread === null) {
    return { kind: "rejected", reason: "This conversation is no longer on its host." };
  }
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
  if (config === null) return { kind: "retry" };
  const turn = readBotSendSettings(environmentId, thread.projectId, thread);
  if (turn.kind === "setup-needed") {
    return { kind: "rejected", reason: `Setup needed: ${turn.reason}` };
  }
  const prepared = await prepareAttachments(item, config, save);
  if (prepared.kind === "stop") return prepared.outcome;
  const context = remapComposerContextAttachments(
    prepared.item.context,
    prepared.item.attachments,
    prepared.attachments.map((attachment, index) => ({
      id: attachment.id ?? prepared.item.attachments[index]!.id,
    })),
  );
  const text = prepared.item.text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT;
  // Servers from before inline context forward the links as literal text instead.
  const message =
    context === undefined
      ? { text }
      : config.environment.capabilities.inlineMessageContext === true
        ? { text, context }
        : { text: serializeLegacyContextMessage({ text, records: context.records }) };

  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
    return { kind: "rejected", reason: "This connection can't send messages to this bot." };
  }
  await beginSend();
  const result = await withTimeout(
    runAtomCommand(
      appAtomRegistry,
      threadEnvironment.startTurn,
      {
        environmentId,
        input: {
          commandId: item.commandId,
          threadId,
          message: {
            messageId: item.messageId,
            role: "user",
            ...message,
            attachments: prepared.attachments,
          },
          modelSelection: turn.modelSelection,
          runtimeMode: turn.runtimeMode,
          interactionMode: thread.interactionMode,
          // Queued messages never interrupt the bot's current work; they take their turn.
          dispatchMode: "queue",
          createdAt: item.createdAt,
        },
      },
      { reportFailure: false },
    ),
  );
  if (result === "timeout" || isAtomCommandInterrupted(result)) return { kind: "retry" };
  if (result._tag === "Success") return { kind: "delivered" };
  const error = squashAtomCommandFailure(result);
  return classifyBotOutboxFailure(error) === "rejected"
    ? { kind: "rejected", reason: describeBotOutboxError(error, "The host refused this message.") }
    : { kind: "retry" };
}
