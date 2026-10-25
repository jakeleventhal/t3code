import type { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { createStore } from "zustand/vanilla";

import {
  botOutboxRetryDelayMs,
  botOutboxThreadKey,
  nextBotOutboxDeliveries,
  orderBotOutboxItems,
  retriedBotOutboxItem,
  type BotOutboxItem,
} from "./botOutbox.logic";
import type { BotOutboxStorage } from "./botOutboxStorage";

export type BotOutboxDeliveryOutcome =
  | { readonly kind: "delivered" }
  /** Not sent, or sent with no answer: try the same command again later. */
  | { readonly kind: "retry" }
  /** The host refused it, or it can't be sent as written; it stays until retried or cancelled. */
  | { readonly kind: "rejected"; readonly reason: string };

export interface BotOutboxDeliveryInput {
  readonly item: BotOutboxItem;
  /** Persists progress, such as an upload's id, before the delivery continues. */
  readonly save: (next: BotOutboxItem) => Promise<BotOutboxItem>;
  /** Called immediately before the command leaves; from here a lost answer is "may have arrived". */
  readonly beginSend: () => Promise<BotOutboxItem>;
}

/** Runs `task` while no other tab or attempt holds `name`. */
export type BotOutboxLock = <A>(name: string, task: () => Promise<A>) => Promise<A>;

export type BotOutboxChannelMessage =
  | { readonly type: "changed" }
  | { readonly type: "sending"; readonly messageId: MessageId | null; readonly until: number };

export interface BotOutboxChannel {
  readonly post: (message: BotOutboxChannelMessage) => void;
  readonly subscribe: (listener: (message: BotOutboxChannelMessage) => void) => () => void;
}

export interface BotOutboxState {
  readonly items: ReadonlyArray<BotOutboxItem>;
  readonly loaded: boolean;
  readonly deliverableEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly sendingMessageId: MessageId | null;
}

export interface BotOutboxOptions {
  readonly storage: BotOutboxStorage;
  readonly lock: BotOutboxLock;
  readonly channel: BotOutboxChannel;
  readonly deliver: (input: BotOutboxDeliveryInput) => Promise<BotOutboxDeliveryOutcome>;
  readonly newCommandId: () => CommandId;
  readonly now?: () => number;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  readonly warn?: (message: string, error: unknown) => void;
}

/**
 * Bounds how long another tab shows "Sending…" for a send it announced; a tab that closed
 * mid-send never announces the end.
 */
const REMOTE_SENDING_TTL_MS = 90_000;

export function createBotOutbox(options: BotOutboxOptions) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    });
  const warn = options.warn ?? ((message, error) => console.warn(message, error));
  const store = createStore<BotOutboxState>(() => ({
    items: [],
    loaded: false,
    deliverableEnvironmentIds: new Set(),
    sendingMessageId: null,
  }));
  const attempts = new Map<MessageId, number>();
  const notBefore = new Map<MessageId, number>();
  const retryTimers = new Map<MessageId, () => void>();
  let localSending: MessageId | null = null;
  let remoteSending: { readonly messageId: MessageId; readonly until: number } | null = null;
  let cancelRemoteSendingExpiry: (() => void) | null = null;
  let started = false;
  let draining: Promise<void> | null = null;
  let drainAgain = false;

  const publishSending = () => {
    const remote = remoteSending !== null && remoteSending.until > now() ? remoteSending : null;
    const sendingMessageId = localSending ?? remote?.messageId ?? null;
    if (store.getState().sendingMessageId !== sendingMessageId)
      store.setState({ sendingMessageId });
  };

  const setItems = (items: ReadonlyArray<BotOutboxItem>) => {
    store.setState({ items: orderBotOutboxItems(items), loaded: true });
  };

  const reload = async (): Promise<ReadonlyArray<BotOutboxItem>> => {
    const items = await options.storage.load();
    setItems(items);
    return items;
  };

  const threadLockName = (item: Pick<BotOutboxItem, "environmentId" | "threadId">) =>
    `t3code:bot-outbox:${botOutboxThreadKey(item)}`;

  const clearRetry = (messageId: MessageId) => {
    attempts.delete(messageId);
    notBefore.delete(messageId);
    retryTimers.get(messageId)?.();
    retryTimers.delete(messageId);
  };

  const scheduleRetry = (messageId: MessageId) => {
    const attempt = (attempts.get(messageId) ?? 0) + 1;
    attempts.set(messageId, attempt);
    const delayMs = botOutboxRetryDelayMs(attempt);
    notBefore.set(messageId, now() + delayMs);
    retryTimers.get(messageId)?.();
    retryTimers.set(
      messageId,
      schedule(() => {
        retryTimers.delete(messageId);
        void drain();
      }, delayMs),
    );
  };

  const announceSending = (messageId: MessageId | null) => {
    localSending = messageId;
    publishSending();
    options.channel.post({ type: "sending", messageId, until: now() + REMOTE_SENDING_TTL_MS });
  };

  /** One send of a conversation's oldest message, under that conversation's lock. */
  const attempt = (candidate: BotOutboxItem): Promise<void> =>
    options.lock(threadLockName(candidate), async () => {
      // Another tab may have delivered, cancelled, or queued ahead of it since the candidate was read.
      const items = await reload();
      const head = nextBotOutboxDeliveries({
        items,
        deliverableEnvironmentIds: store.getState().deliverableEnvironmentIds,
        notBefore,
        now: now(),
      }).find((item) => item.messageId === candidate.messageId);
      if (head === undefined) return;
      announceSending(head.messageId);
      let current = head;
      const save = async (next: BotOutboxItem) => {
        await options.storage.put(next);
        current = next;
        return next;
      };
      try {
        const outcome = await options
          .deliver({
            item: head,
            save,
            beginSend: () => save({ ...current, uncertain: true }),
          })
          .catch((error: unknown): BotOutboxDeliveryOutcome => {
            warn("[bot-outbox] delivery failed unexpectedly", error);
            return { kind: "retry" };
          });
        if (outcome.kind === "delivered") {
          await options.storage.remove(head.messageId);
          clearRetry(head.messageId);
        } else if (outcome.kind === "rejected") {
          // This attempt never ran, so only an earlier attempt's uncertainty carries forward.
          await options.storage.put({
            ...current,
            uncertain: head.uncertain,
            failure: outcome.reason,
          });
          clearRetry(head.messageId);
        } else {
          scheduleRetry(head.messageId);
        }
      } catch (error) {
        warn("[bot-outbox] could not record a delivery result", error);
        scheduleRetry(head.messageId);
      } finally {
        announceSending(null);
        options.channel.post({ type: "changed" });
        await reload().catch((error: unknown) => warn("[bot-outbox] reload failed", error));
      }
    });

  const drain = (): Promise<void> => {
    if (draining !== null) {
      drainAgain = true;
      return draining;
    }
    const run = async () => {
      do {
        drainAgain = false;
        for (;;) {
          const candidates = nextBotOutboxDeliveries({
            items: store.getState().items,
            deliverableEnvironmentIds: store.getState().deliverableEnvironmentIds,
            notBefore,
            now: now(),
          });
          if (candidates.length === 0) break;
          for (const candidate of candidates) {
            await attempt(candidate).catch((error: unknown) => {
              warn("[bot-outbox] delivery attempt failed", error);
              scheduleRetry(candidate.messageId);
            });
          }
        }
      } while (drainAgain);
    };
    // Cleared after assignment: a run with nothing to send settles before `draining` is set.
    const current: Promise<void> = run().finally(() => {
      if (draining === current) draining = null;
      // A request that arrived as the last pass ended still gets its pass.
      if (drainAgain) void drain();
    });
    draining = current;
    return current;
  };

  const onChannelMessage = (message: BotOutboxChannelMessage) => {
    if (message.type === "changed") {
      void reload()
        .then(() => drain())
        .catch((error: unknown) => warn("[bot-outbox] reload failed", error));
      return;
    }
    remoteSending =
      message.messageId === null ? null : { messageId: message.messageId, until: message.until };
    cancelRemoteSendingExpiry?.();
    cancelRemoteSendingExpiry =
      remoteSending === null
        ? null
        : schedule(publishSending, Math.max(0, remoteSending.until - now()));
    publishSending();
  };

  const findItem = async (messageId: MessageId) =>
    store.getState().items.find((item) => item.messageId === messageId) ??
    (await reload()).find((item) => item.messageId === messageId);

  return {
    store,

    start: async (): Promise<void> => {
      if (started) return;
      started = true;
      options.channel.subscribe(onChannelMessage);
      try {
        await reload();
      } catch (error) {
        warn("[bot-outbox] could not load unsent bot messages", error);
        store.setState({ loaded: true });
      }
      await drain();
    },

    /** Resolves once the message is on disk; a rejection means nothing was queued. */
    enqueue: async (item: BotOutboxItem): Promise<void> => {
      await options.storage.put(item);
      setItems([
        ...store.getState().items.filter((current) => current.messageId !== item.messageId),
        item,
      ]);
      options.channel.post({ type: "changed" });
      void drain();
    },

    /**
     * Waits for any send of this conversation in flight, so a message is either delivered or
     * cancelled, never both.
     */
    cancel: async (messageId: MessageId): Promise<"cancelled" | "gone"> => {
      const item = await findItem(messageId);
      if (item === undefined) return "gone";
      const result = await options.lock(threadLockName(item), async () => {
        const items = await options.storage.load();
        if (!items.some((candidate) => candidate.messageId === messageId)) {
          setItems(items);
          return "gone" as const;
        }
        await options.storage.remove(messageId);
        setItems(items.filter((candidate) => candidate.messageId !== messageId));
        return "cancelled" as const;
      });
      clearRetry(messageId);
      options.channel.post({ type: "changed" });
      // The message behind a cancelled refusal may go now.
      void drain();
      return result;
    },

    retry: async (messageId: MessageId): Promise<void> => {
      const item = await findItem(messageId);
      if (item === undefined) return;
      await options.lock(threadLockName(item), async () => {
        const items = await options.storage.load();
        const current = items.find((candidate) => candidate.messageId === messageId);
        if (current === undefined || current.failure === null) {
          setItems(items);
          return;
        }
        const next = retriedBotOutboxItem(current, options.newCommandId);
        await options.storage.put(next);
        setItems(items.map((candidate) => (candidate.messageId === messageId ? next : candidate)));
      });
      clearRetry(messageId);
      options.channel.post({ type: "changed" });
      void drain();
    },

    /** Environments connected with a synchronized thread list; a newly connected one retries now. */
    setDeliverableEnvironments: (environmentIds: ReadonlySet<EnvironmentId>): void => {
      const previous = store.getState().deliverableEnvironmentIds;
      if (
        previous.size === environmentIds.size &&
        [...environmentIds].every((environmentId) => previous.has(environmentId))
      ) {
        return;
      }
      for (const item of store.getState().items) {
        if (environmentIds.has(item.environmentId) && !previous.has(item.environmentId)) {
          clearRetry(item.messageId);
        }
      }
      store.setState({ deliverableEnvironmentIds: new Set(environmentIds) });
      void drain();
    },

    drain,

    hasThreadItems: (environmentId: EnvironmentId, threadId: ThreadId): boolean =>
      store
        .getState()
        .items.some((item) => item.environmentId === environmentId && item.threadId === threadId),
  };
}

export type BotOutbox = ReturnType<typeof createBotOutbox>;
