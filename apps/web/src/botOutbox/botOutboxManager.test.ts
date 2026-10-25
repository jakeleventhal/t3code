import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BOT_OUTBOX_VERSION, type BotOutboxItem } from "./botOutbox.logic";
import {
  createBotOutbox,
  type BotOutboxChannel,
  type BotOutboxChannelMessage,
  type BotOutboxDeliveryInput,
  type BotOutboxDeliveryOutcome,
  type BotOutboxLock,
} from "./botOutboxManager";
import type { BotOutboxStorage } from "./botOutboxStorage";

const env = EnvironmentId.make("env-host");
const threadA = ThreadId.make("thread-a");
const threadB = ThreadId.make("thread-b");

let sequence = 0;
function item(messageId: string, threadId = threadA): BotOutboxItem {
  sequence += 1;
  return {
    version: BOT_OUTBOX_VERSION,
    messageId: MessageId.make(messageId),
    commandId: CommandId.make(`command-${messageId}`),
    environmentId: env,
    threadId,
    text: messageId,
    attachments: [],
    createdAt: "2026-10-24T12:00:00.000Z",
    sequence,
    uncertain: false,
    failure: null,
  };
}

function memoryStorage(options: { readonly failPut?: () => boolean } = {}) {
  const records = new Map<MessageId, BotOutboxItem>();
  const storage: BotOutboxStorage = {
    load: async () => [...records.values()],
    put: async (next) => {
      if (options.failPut?.()) throw new Error("Quota exceeded");
      records.set(next.messageId, next);
    },
    remove: async (messageId) => {
      records.delete(messageId);
    },
  };
  return { records, storage };
}

/** Same contract as Web Locks: one holder per name, shared by every tab given this lock. */
function memoryLock(): BotOutboxLock {
  const tails = new Map<string, Promise<unknown>>();
  return (name, task) => {
    const result = (tails.get(name) ?? Promise.resolve()).then(task, task);
    tails.set(
      name,
      result.catch(() => undefined),
    );
    return result;
  };
}

/** Same contract as BroadcastChannel: a post reaches the other tabs, not the sender. */
function memoryBus() {
  const channels = new Set<Set<(message: BotOutboxChannelMessage) => void>>();
  return (): BotOutboxChannel => {
    const own = new Set<(message: BotOutboxChannelMessage) => void>();
    channels.add(own);
    return {
      post: (message) => {
        for (const listeners of channels) {
          if (listeners === own) continue;
          for (const listener of listeners) queueMicrotask(() => listener(message));
        }
      },
      subscribe: (listener) => {
        own.add(listener);
        return () => own.delete(listener);
      },
    };
  };
}

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Resolves once the outbox's state satisfies `predicate`, as a tab's UI would observe it. */
function stateWhere(
  outbox: ReturnType<typeof createBotOutbox>,
  predicate: (items: ReadonlyArray<BotOutboxItem>) => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    if (predicate(outbox.store.getState().items)) return resolve();
    const unsubscribe = outbox.store.subscribe((state) => {
      if (!predicate(state.items)) return;
      unsubscribe();
      resolve();
    });
  });
}

interface Call {
  readonly messageId: MessageId;
  readonly commandId: CommandId;
}

function harness(
  options: {
    readonly storage?: ReturnType<typeof memoryStorage>;
    readonly lock?: BotOutboxLock;
    readonly channel?: BotOutboxChannel;
    readonly deliver?: (input: BotOutboxDeliveryInput) => Promise<BotOutboxDeliveryOutcome>;
  } = {},
) {
  const storage = options.storage ?? memoryStorage();
  const calls: Call[] = [];
  let clock = 0;
  let commandIds = 0;
  const outbox = createBotOutbox({
    storage: storage.storage,
    lock: options.lock ?? memoryLock(),
    channel: options.channel ?? memoryBus()(),
    deliver: async (input) => {
      calls.push({ messageId: input.item.messageId, commandId: input.item.commandId });
      if (options.deliver) return options.deliver(input);
      await input.beginSend();
      return { kind: "delivered" };
    },
    newCommandId: () => {
      commandIds += 1;
      return CommandId.make(`retry-command-${commandIds}`);
    },
    now: () => clock,
    schedule: () => () => {},
    warn: () => {},
  });
  return {
    outbox,
    calls,
    records: storage.records,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const online = new Set([env]);

describe("bot outbox", () => {
  it("queues nothing when the message can't be saved, so the draft is the only copy", async () => {
    const { outbox, calls } = harness({ storage: memoryStorage({ failPut: () => true }) });
    outbox.setDeliverableEnvironments(online);

    await expect(outbox.enqueue(item("m1"))).rejects.toThrow("Quota exceeded");
    await outbox.drain();

    expect(outbox.store.getState().items).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("holds messages while offline and sends them in order once the host is back", async () => {
    const first = deferred<BotOutboxDeliveryOutcome>();
    const firstStarted = deferred<void>();
    const { outbox, calls, records } = harness({
      deliver: async ({ item: next, beginSend }) => {
        await beginSend();
        if (next.messageId !== "a1") return { kind: "delivered" };
        firstStarted.resolve();
        return first.promise;
      },
    });
    await outbox.enqueue(item("a1"));
    await outbox.enqueue(item("a2"));
    await outbox.enqueue(item("b1", threadB));
    await outbox.drain();
    expect(calls).toEqual([]);

    outbox.setDeliverableEnvironments(online);
    const drained = outbox.drain();
    await firstStarted.promise;
    // a2 waits for a1's answer; the other conversation isn't held up by it.
    expect(calls.map((call) => call.messageId)).toEqual(["a1"]);

    first.resolve({ kind: "delivered" });
    await drained;
    expect(calls.map((call) => call.messageId)).toEqual(["a1", "b1", "a2"]);
    expect(records.size).toBe(0);
  });

  it("retries an unanswered send as the same message and command", async () => {
    let attempt = 0;
    const { outbox, calls, records, advance } = harness({
      deliver: async ({ beginSend }) => {
        attempt += 1;
        await beginSend();
        return attempt === 1 ? { kind: "retry" } : { kind: "delivered" };
      },
    });
    outbox.setDeliverableEnvironments(online);
    await outbox.enqueue(item("m1"));
    await outbox.drain();

    expect(records.get(MessageId.make("m1"))?.uncertain).toBe(true);
    advance(60_000);
    await outbox.drain();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(records.size).toBe(0);
  });

  it("holds a conversation behind a refused message until it is retried", async () => {
    let refuse = true;
    const { outbox, calls, records } = harness({
      deliver: async ({ item: next, beginSend }) => {
        await beginSend();
        if (next.messageId === "a1" && refuse) {
          return { kind: "rejected", reason: "Setup needed: pick a model" };
        }
        return { kind: "delivered" };
      },
    });
    outbox.setDeliverableEnvironments(online);
    await outbox.enqueue(item("a1"));
    await outbox.enqueue(item("a2"));
    await outbox.enqueue(item("b1", threadB));
    await outbox.drain();

    expect(calls.map((call) => call.messageId)).toEqual(["a1", "b1"]);
    expect(records.get(MessageId.make("a1"))).toMatchObject({
      failure: "Setup needed: pick a model",
      uncertain: false,
    });
    expect(records.has(MessageId.make("a2"))).toBe(true);

    refuse = false;
    await outbox.retry(MessageId.make("a1"));
    await outbox.drain();

    // The refused command never ran, so the retry is a new command for the same message.
    expect(calls.slice(2)).toEqual([
      { messageId: MessageId.make("a1"), commandId: CommandId.make("retry-command-1") },
      { messageId: MessageId.make("a2"), commandId: CommandId.make("command-a2") },
    ]);
    expect(records.size).toBe(0);
  });

  it("never re-issues a command that may already be on the host under a new id", async () => {
    // A send cut short by a crash or a dropped socket, then refused on the next try.
    const storage = memoryStorage();
    storage.records.set(MessageId.make("m1"), { ...item("m1"), uncertain: true });
    let attempt = 0;
    const { outbox, calls, records } = harness({
      storage,
      deliver: async ({ beginSend }) => {
        attempt += 1;
        await beginSend();
        return attempt === 1
          ? { kind: "rejected", reason: "Provider disabled" }
          : { kind: "delivered" };
      },
    });
    await outbox.start();
    outbox.setDeliverableEnvironments(online);
    await outbox.drain();
    expect(records.get(MessageId.make("m1"))).toMatchObject({ uncertain: true });

    await outbox.retry(MessageId.make("m1"));
    await outbox.drain();

    expect(calls.map((call) => call.commandId)).toEqual([
      CommandId.make("command-m1"),
      CommandId.make("command-m1"),
    ]);
  });

  it("cancels a waiting message so it never sends, and never cancels one mid-send", async () => {
    const inFlight = deferred<BotOutboxDeliveryOutcome>();
    const started = deferred<void>();
    const { outbox, calls, records } = harness({
      deliver: async ({ item: next, beginSend }) => {
        await beginSend();
        if (next.messageId !== "a1") return { kind: "delivered" };
        started.resolve();
        return inFlight.promise;
      },
    });
    await outbox.enqueue(item("a1"));
    await outbox.enqueue(item("b1", threadB));
    expect(await outbox.cancel(MessageId.make("b1"))).toBe("cancelled");

    outbox.setDeliverableEnvironments(online);
    const drained = outbox.drain();
    await started.promise;
    const cancelling = outbox.cancel(MessageId.make("a1"));
    inFlight.resolve({ kind: "delivered" });

    expect(await cancelling).toBe("gone");
    await drained;
    expect(calls.map((call) => call.messageId)).toEqual(["a1"]);
    expect(records.size).toBe(0);
  });

  it("delivers a message once when several tabs drain the same queue", async () => {
    const storage = memoryStorage();
    const lock = memoryLock();
    const bus = memoryBus();
    const delivered: MessageId[] = [];
    const deliver = async ({ item: next, beginSend }: BotOutboxDeliveryInput) => {
      await beginSend();
      delivered.push(next.messageId);
      return { kind: "delivered" } as const;
    };
    const tabA = harness({ storage, lock, channel: bus(), deliver });
    const tabB = harness({ storage, lock, channel: bus(), deliver });
    await tabA.outbox.start();
    await tabB.outbox.start();
    await tabA.outbox.enqueue(item("m1"));
    await tabA.outbox.enqueue(item("m2"));
    // Tab B learns about the queue from tab A's broadcast.
    await stateWhere(tabB.outbox, (items) => items.length === 2);

    tabA.outbox.setDeliverableEnvironments(online);
    tabB.outbox.setDeliverableEnvironments(online);
    await Promise.all([tabA.outbox.drain(), tabB.outbox.drain()]);
    await stateWhere(tabB.outbox, (items) => items.length === 0);

    expect(delivered).toEqual(["m1", "m2"]);
    expect(storage.records.size).toBe(0);
  });

  it("delivers once even when tabs miss each other's broadcasts", async () => {
    const storage = memoryStorage();
    const lock = memoryLock();
    const delivered: MessageId[] = [];
    const deliver = async ({ item: next, beginSend }: BotOutboxDeliveryInput) => {
      await beginSend();
      delivered.push(next.messageId);
      return { kind: "delivered" } as const;
    };
    // Separate buses: neither tab hears the other, so each starts from what it loaded.
    const tabA = harness({ storage, lock, channel: memoryBus()(), deliver });
    const tabB = harness({ storage, lock, channel: memoryBus()(), deliver });
    await tabA.outbox.enqueue(item("m1"));
    await tabB.outbox.start();
    expect(tabB.outbox.store.getState().items).toHaveLength(1);

    tabA.outbox.setDeliverableEnvironments(online);
    tabB.outbox.setDeliverableEnvironments(online);
    await Promise.all([tabA.outbox.drain(), tabB.outbox.drain()]);

    expect(delivered).toEqual(["m1"]);
  });
});
