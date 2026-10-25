import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../composerDraftStore";
import { useAttachmentUploadStore } from "../lib/attachmentUploadQueue";
import { composerBotOutboxItem } from "./composerBotOutbox";

const env = EnvironmentId.make("env-host");
const image: ComposerImageAttachment = {
  type: "image",
  id: "local-image",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 3,
  previewUrl: "blob:shot",
  file: new File(["png"], "shot.png", { type: "image/png" }),
};
const interruptedFile: ComposerFileAttachment = {
  type: "file",
  id: "local-file",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  file: null,
};

afterEach(() => {
  useAttachmentUploadStore.setState({ uploadsByImageId: {} });
});

describe("composerBotOutboxItem", () => {
  it("keeps a send that already left as the same command, with what it uploaded", () => {
    useAttachmentUploadStore.setState({
      uploadsByImageId: {
        [image.id]: { status: "ready", environmentId: env, attachmentId: "upload-1" },
      },
    });
    const commandId = CommandId.make("command-sent");
    const result = composerBotOutboxItem({
      messageId: MessageId.make("message-sent"),
      environmentId: env,
      threadId: ThreadId.make("thread"),
      text: "look at this",
      context: undefined,
      attachments: [image],
      sent: { commandId, createdAt: "2026-10-24T12:00:00.000Z" },
    });
    if (!("item" in result)) throw new Error(result.error);
    expect(result.item).toMatchObject({
      messageId: "message-sent",
      commandId,
      createdAt: "2026-10-24T12:00:00.000Z",
      uncertain: true,
      text: "look at this",
    });
    // The bytes stay too, so the upload can be redone if it expires before delivery.
    expect(result.item.attachments).toEqual([
      expect.objectContaining({
        id: image.id,
        file: image.file,
        uploaded: { environmentId: env, attachmentId: "upload-1" },
      }),
    ]);
  });

  it("queues local bytes that never started uploading", () => {
    const result = composerBotOutboxItem({
      messageId: MessageId.make("message-offline"),
      environmentId: env,
      threadId: ThreadId.make("thread"),
      text: "",
      context: undefined,
      attachments: [image],
    });
    if (!("item" in result)) throw new Error(result.error);
    expect(result.item.uncertain).toBe(false);
    expect(result.item.attachments[0]).toMatchObject({ file: image.file });
    expect(result.item.attachments[0]?.uploaded).toBeUndefined();
  });

  it("refuses an attachment whose bytes are gone instead of dropping it", () => {
    const result = composerBotOutboxItem({
      messageId: MessageId.make("message-interrupted"),
      environmentId: env,
      threadId: ThreadId.make("thread"),
      text: "notes",
      context: undefined,
      attachments: [interruptedFile],
    });
    expect(result).toEqual({ error: "Attach 'notes.txt' again before sending." });
  });
});
