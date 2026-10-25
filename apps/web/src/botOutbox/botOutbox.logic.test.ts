import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOT_OUTBOX_VERSION,
  botOutboxRows,
  classifyBotOutboxFailure,
  retriedBotOutboxItem,
  type BotOutboxItem,
} from "./botOutbox.logic";

const env = EnvironmentId.make("env-host");

function item(messageId: string, overrides: Partial<BotOutboxItem> = {}): BotOutboxItem {
  return {
    version: BOT_OUTBOX_VERSION,
    messageId: MessageId.make(messageId),
    commandId: CommandId.make(`command-${messageId}`),
    environmentId: env,
    threadId: ThreadId.make("thread"),
    text: messageId,
    attachments: [],
    createdAt: `2026-10-24T12:00:0${messageId.at(-1)}.000Z`,
    sequence: 0,
    uncertain: false,
    failure: null,
    ...overrides,
  };
}

describe("classifyBotOutboxFailure", () => {
  it("stops only on the host's own refusal; anything that may have reached it is retried", () => {
    expect(
      classifyBotOutboxFailure({ _tag: "OrchestrationV2DispatchCommandError", message: "No" }),
    ).toBe("rejected");
    expect(classifyBotOutboxFailure({ _tag: "EnvironmentAuthorizationError" })).toBe("rejected");
    expect(classifyBotOutboxFailure({ _tag: "RpcClientError", reason: {} })).toBe("retry");
    expect(classifyBotOutboxFailure({ _tag: "EnvironmentRpcUnavailableError" })).toBe("retry");
    expect(classifyBotOutboxFailure(new Error("Something unexpected"))).toBe("retry");
  });
});

describe("botOutboxRows", () => {
  it("says what each unsent message is waiting on, never that it was sent", () => {
    const rows = botOutboxRows({
      items: [
        item("m2"),
        item("m1", { failure: "Setup needed: pick a model" }),
        item("m3", { uncertain: true }),
      ],
      deliverable: false,
      sendingMessageId: null,
      hostLabel: "Jakebook",
    });
    expect(rows.map((row) => [row.item.messageId, row.label, row.canCancel, row.canRetry])).toEqual(
      [
        ["m1", "Not delivered", true, true],
        ["m2", "Waiting on an earlier message", true, false],
        ["m3", "Waiting on an earlier message", true, false],
      ],
    );
    expect(rows[0]?.detail).toBe("Setup needed: pick a model");
  });

  it("offers no cancel while a send is in flight, and flags a send that may have arrived", () => {
    const rows = botOutboxRows({
      items: [item("m1", { uncertain: true }), item("m2")],
      deliverable: true,
      sendingMessageId: MessageId.make("m1"),
      hostLabel: "Jakebook",
    });
    expect(rows[0]).toMatchObject({ label: "Sending…", canCancel: false });
    expect(rows[1]).toMatchObject({ label: "Waiting to send", canCancel: true });

    const offline = botOutboxRows({
      items: [item("m1", { uncertain: true })],
      deliverable: false,
      sendingMessageId: null,
      hostLabel: "Jakebook",
    });
    expect(offline[0]?.label).toBe("Waiting for connection");
    expect(offline[0]?.detail).toContain("may already have reached Jakebook");
  });
});

describe("retriedBotOutboxItem", () => {
  const file = new File(["bytes"], "notes.txt", { type: "text/plain" });
  const uploaded = { environmentId: env, attachmentId: "upload-1" };

  it("re-uploads kept bytes, since a long wait can outlive the host's pending upload", () => {
    const retried = retriedBotOutboxItem(
      item("m1", {
        failure: "Attachment expired",
        attachments: [
          {
            id: "a",
            type: "file",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
            file,
            uploaded,
          },
          {
            id: "b",
            type: "file",
            name: "old.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
            file: null,
            uploaded,
          },
        ],
      }),
      () => CommandId.make("fresh"),
    );
    expect(retried.failure).toBeNull();
    expect(retried.commandId).toBe("fresh");
    expect(retried.attachments.map((attachment) => attachment.uploaded)).toEqual([
      undefined,
      uploaded,
    ]);
  });
});
