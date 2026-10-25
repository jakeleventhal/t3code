import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import type {
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationMessageContext,
  PastedTextAttachmentSource,
  SnapShotSource,
  ThreadId,
} from "@t3tools/contracts";

export const BOT_OUTBOX_VERSION = 1;
const BOT_OUTBOX_MAX_RETRY_DELAY_MS = 30_000;

interface BotOutboxAttachmentBase {
  /** The composer's local id; the message context binds to it until an upload replaces it. */
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** The bytes, kept so a send after reconnect can upload them. Null when only `uploaded` holds them. */
  readonly file: File | null;
  readonly uploaded?: { readonly environmentId: EnvironmentId; readonly attachmentId: string };
}

export type BotOutboxAttachment =
  | (BotOutboxAttachmentBase & { readonly type: "image"; readonly source?: SnapShotSource })
  | (BotOutboxAttachmentBase & {
      readonly type: "file";
      readonly source?: PastedTextAttachmentSource;
    });

/**
 * One user message to a bot that has not reached its host. `messageId` and `commandId` are fixed
 * at Send so every attempt is the same command: the server replays a repeated command id instead
 * of starting the turn twice.
 */
export interface BotOutboxItem {
  readonly version: typeof BOT_OUTBOX_VERSION;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  readonly attachments: ReadonlyArray<BotOutboxAttachment>;
  readonly createdAt: string;
  /** Tie-breaker for messages queued within the same millisecond. */
  readonly sequence: number;
  /**
   * Set before each send and kept when the send's outcome is unknown, so a crash mid-send counts
   * too. While set, this command may already be on the host, so it is never re-issued under a
   * new id.
   */
  readonly uncertain: boolean;
  /** The host refused this command; the thread's later messages wait behind it. */
  readonly failure: string | null;
}

export function botOutboxThreadKey(
  item: Pick<BotOutboxItem, "environmentId" | "threadId">,
): string {
  return `${item.environmentId}\u0000${item.threadId}`;
}

export function compareBotOutboxItems(left: BotOutboxItem, right: BotOutboxItem): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.sequence - right.sequence ||
    left.messageId.localeCompare(right.messageId)
  );
}

export function orderBotOutboxItems(
  items: ReadonlyArray<BotOutboxItem>,
): ReadonlyArray<BotOutboxItem> {
  return items.toSorted(compareBotOutboxItems);
}

/**
 * The oldest message of each conversation, when it may be sent now. A conversation sends one
 * message at a time and stops at one its host refused, so messages arrive in the order written.
 */
export function nextBotOutboxDeliveries(input: {
  readonly items: ReadonlyArray<BotOutboxItem>;
  readonly deliverableEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly notBefore: ReadonlyMap<MessageId, number>;
  readonly now: number;
}): ReadonlyArray<BotOutboxItem> {
  const heads = new Map<string, BotOutboxItem>();
  for (const item of orderBotOutboxItems(input.items)) {
    const key = botOutboxThreadKey(item);
    if (!heads.has(key)) heads.set(key, item);
  }
  return [...heads.values()].filter(
    (item) =>
      item.failure === null &&
      input.deliverableEnvironmentIds.has(item.environmentId) &&
      (input.notBefore.get(item.messageId) ?? 0) <= input.now,
  );
}

export function botOutboxRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), BOT_OUTBOX_MAX_RETRY_DELAY_MS);
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : null;
  }
  return typeof error === "string" ? error : null;
}

/**
 * "rejected" only when the host decided: its dispatch or attachment error, or an authorization
 * refusal before the command ran. Everything else may have reached the host, so the same command is retried and
 * the server's receipt answers whether it already ran.
 */
export function classifyBotOutboxFailure(error: unknown): "rejected" | "retry" {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch (error._tag) {
      case "OrchestrationDispatchCommandError":
      case "OrchestrationV2DispatchCommandError":
      case "PersistChatAttachmentsError":
      case "EnvironmentAuthorizationError":
        return "rejected";
      default:
        break;
    }
  }
  return "retry";
}

export function describeBotOutboxError(error: unknown, fallback: string): string {
  const message = errorMessage(error)?.trim();
  return message && !isTransportConnectionErrorMessage(message) ? message : fallback;
}

/** A queued message's retry after the host refused it: a new command only if the old one never ran. */
export function retriedBotOutboxItem(
  item: BotOutboxItem,
  newCommandId: () => CommandId,
): BotOutboxItem {
  return {
    ...item,
    commandId: item.uncertain ? item.commandId : newCommandId(),
    failure: null,
    // An upload may have expired while the message waited; send the kept bytes again.
    attachments: item.attachments.map((attachment) => {
      if (attachment.file === null || attachment.uploaded === undefined) return attachment;
      const { uploaded: _, ...rest } = attachment;
      return rest;
    }),
  };
}

export type BotOutboxRowState = "sending" | "waiting-connection" | "waiting" | "blocked" | "failed";

export interface BotOutboxRow {
  readonly item: BotOutboxItem;
  readonly state: BotOutboxRowState;
  readonly label: string;
  readonly detail: string | null;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
}

/** What one conversation's unsent messages show. Nothing here claims delivery or work. */
export function botOutboxRows(input: {
  readonly items: ReadonlyArray<BotOutboxItem>;
  readonly deliverable: boolean;
  readonly sendingMessageId: MessageId | null;
  readonly hostLabel: string | null;
}): ReadonlyArray<BotOutboxRow> {
  let blockedBy: BotOutboxItem | null = null;
  return orderBotOutboxItems(input.items).map((item) => {
    const uncertainDetail = item.uncertain
      ? `It may already have reached ${input.hostLabel ?? "the host"}; this is confirmed on reconnect.`
      : null;
    let row: BotOutboxRow;
    if (item.failure !== null) {
      row = {
        item,
        state: "failed",
        label: "Not delivered",
        detail: item.failure,
        canCancel: true,
        canRetry: true,
      };
    } else if (item.messageId === input.sendingMessageId) {
      row = {
        item,
        state: "sending",
        label: "Sending…",
        detail: null,
        canCancel: false,
        canRetry: false,
      };
    } else if (blockedBy !== null) {
      row = {
        item,
        state: "blocked",
        label: "Waiting on an earlier message",
        detail: null,
        canCancel: true,
        canRetry: false,
      };
    } else {
      row = {
        item,
        state: input.deliverable ? "waiting" : "waiting-connection",
        label: input.deliverable ? "Waiting to send" : "Waiting for connection",
        detail: uncertainDetail,
        canCancel: true,
        canRetry: false,
      };
    }
    if (item.failure !== null && blockedBy === null) blockedBy = item;
    return row;
  });
}
