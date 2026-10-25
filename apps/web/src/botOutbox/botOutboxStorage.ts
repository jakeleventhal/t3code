import type { MessageId } from "@t3tools/contracts";

import { BOT_OUTBOX_VERSION, type BotOutboxItem } from "./botOutbox.logic";

export interface BotOutboxStorage {
  readonly load: () => Promise<ReadonlyArray<BotOutboxItem>>;
  readonly put: (item: BotOutboxItem) => Promise<void>;
  readonly remove: (messageId: MessageId) => Promise<void>;
}

const DATABASE_NAME = "t3code:bot-outbox";
const DATABASE_VERSION = 1;
const STORE_NAME = "messages";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "messageId" });
      }
    });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB error")));
    request.addEventListener("success", () => resolve(request.result));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  databasePromise ??= openDatabase().then((opened) => {
    // Another tab's upgrade (or the browser clearing storage) closes this handle; reopen next time.
    opened.addEventListener("versionchange", () => {
      opened.close();
      databasePromise = null;
    });
    opened.addEventListener("close", () => {
      databasePromise = null;
    });
    return opened;
  });
  return databasePromise.catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
}

/** Resolves when the transaction commits, so a write the caller awaited is on disk. */
async function transact(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest | void,
): Promise<unknown> {
  const opened = await database();
  return new Promise((resolve, reject) => {
    const transaction = opened.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    transaction.addEventListener("complete", () => resolve(request?.result));
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    );
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
  });
}

function isStoredItem(value: unknown): value is BotOutboxItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<BotOutboxItem>;
  return (
    item.version === BOT_OUTBOX_VERSION &&
    typeof item.messageId === "string" &&
    typeof item.commandId === "string" &&
    typeof item.environmentId === "string" &&
    typeof item.threadId === "string" &&
    typeof item.text === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.sequence === "number" &&
    typeof item.uncertain === "boolean" &&
    (item.failure === null || typeof item.failure === "string") &&
    Array.isArray(item.attachments)
  );
}

export const indexedDbBotOutboxStorage: BotOutboxStorage = {
  load: async () => {
    const values = await transact("readonly", (store) => store.getAll());
    // A record this version can't read stays on disk for the version that wrote it.
    return Array.isArray(values) ? values.filter(isStoredItem) : [];
  },
  put: async (item) => {
    await transact("readwrite", (store) => store.put(item));
  },
  remove: async (messageId) => {
    await transact("readwrite", (store) => store.delete(messageId));
  },
};
