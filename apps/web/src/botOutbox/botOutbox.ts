import {
  CommandId,
  type EnvironmentId,
  type MessageId,
  type OrchestrationMessageContext,
  type ThreadId,
} from "@t3tools/contracts";
import { useStore } from "zustand";

import { randomUUID } from "../lib/utils";
import {
  BOT_OUTBOX_VERSION,
  botOutboxRows,
  type BotOutboxAttachment,
  type BotOutboxItem,
} from "./botOutbox.logic";
import { deliverBotOutboxItem } from "./botOutboxDelivery";
import {
  createBotOutbox,
  type BotOutboxChannel,
  type BotOutboxChannelMessage,
  type BotOutboxLock,
} from "./botOutboxManager";
import { indexedDbBotOutboxStorage } from "./botOutboxStorage";

const localLockTails = new Map<string, Promise<unknown>>();

/** Web Locks serialize across this origin's tabs and windows; without them, only within this tab. */
const browserLock: BotOutboxLock = (name, task) => {
  if (typeof navigator !== "undefined" && navigator.locks !== undefined) {
    return navigator.locks.request(name, () => task());
  }
  const result = (localLockTails.get(name) ?? Promise.resolve()).then(task, task);
  localLockTails.set(
    name,
    result.catch(() => undefined),
  );
  return result;
};

function isChannelMessage(value: unknown): value is BotOutboxChannelMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  return value.type === "changed" || value.type === "sending";
}

/** Opened on first use, so importing this module (as tests do) never holds a channel open. */
function browserChannel(): BotOutboxChannel {
  let channel: BroadcastChannel | null = null;
  const open = () => {
    if (typeof BroadcastChannel === "undefined") return null;
    channel ??= new BroadcastChannel("t3code:bot-outbox");
    return channel;
  };
  return {
    post: (message) => open()?.postMessage(message),
    subscribe: (listener) => {
      const opened = open();
      if (opened === null) return () => {};
      const onMessage = (event: MessageEvent) => {
        if (isChannelMessage(event.data)) listener(event.data);
      };
      opened.addEventListener("message", onMessage);
      return () => opened.removeEventListener("message", onMessage);
    },
  };
}

export const botOutbox = createBotOutbox({
  storage: indexedDbBotOutboxStorage,
  lock: browserLock,
  channel: browserChannel(),
  deliver: deliverBotOutboxItem,
  newCommandId: () => CommandId.make(randomUUID()),
});

let sequence = 0;

export function createBotOutboxItem(input: {
  readonly messageId: MessageId;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  readonly attachments?: ReadonlyArray<BotOutboxAttachment>;
  /** A send that already left keeps its ids, time, and "may have arrived" here. */
  readonly sent?: { readonly commandId: CommandId; readonly createdAt: string };
}): BotOutboxItem {
  sequence += 1;
  return {
    version: BOT_OUTBOX_VERSION,
    messageId: input.messageId,
    commandId: input.sent?.commandId ?? CommandId.make(randomUUID()),
    environmentId: input.environmentId,
    threadId: input.threadId,
    text: input.text,
    ...(input.context ? { context: input.context } : {}),
    attachments: input.attachments ?? [],
    createdAt: input.sent?.createdAt ?? new Date().toISOString(),
    sequence,
    uncertain: input.sent !== undefined,
    failure: null,
  };
}

/** Whether a send to this conversation must queue behind unsent messages to keep their order. */
export function botOutboxHoldsThread(environmentId: EnvironmentId, threadId: ThreadId): boolean {
  return botOutbox.hasThreadItems(environmentId, threadId);
}

export function useBotOutboxRows(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  hostLabel: string | null,
) {
  const items = useStore(botOutbox.store, (state) => state.items);
  const deliverable = useStore(botOutbox.store, (state) =>
    state.deliverableEnvironmentIds.has(environmentId),
  );
  const sendingMessageId = useStore(botOutbox.store, (state) => state.sendingMessageId);
  if (threadId === null) return [];
  return botOutboxRows({
    items: items.filter(
      (item) => item.environmentId === environmentId && item.threadId === threadId,
    ),
    deliverable,
    sendingMessageId,
    hostLabel,
  });
}
