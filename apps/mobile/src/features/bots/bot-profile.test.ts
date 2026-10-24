import { ChatAttachmentId, ThreadId, type BotFile } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botFilePreviewTarget,
  botInitials,
  botRoutineScheduleLabel,
  groupBotFiles,
  mergeBotFilePages,
} from "./bot-profile";

function file(id: string, createdAt: string): BotFile {
  return {
    id,
    title: id,
    createdAt,
    sourceThreadId: ThreadId.make("thread"),
    sourceMessageId: null,
    sourceTurnItemId: null,
    kind: "attachment",
    attachment: {
      type: "file",
      id: ChatAttachmentId.make(`attachment-${id}`),
      name: `${id}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 10,
    },
  } as BotFile;
}

describe("bot profile", () => {
  it("groups files by the viewer's calendar", () => {
    const now = new Date(2026, 9, 24, 15).getTime();
    const groups = groupBotFiles(
      [
        file("today", new Date(2026, 9, 24, 8).toISOString()),
        file("week", new Date(2026, 9, 19, 8).toISOString()),
        file("older", new Date(2026, 9, 10, 8).toISOString()),
      ],
      now,
    );
    expect(groups.map((group) => [group.label, group.files.map((entry) => entry.id)])).toEqual([
      ["Today", ["today"]],
      ["This week", ["week"]],
      ["Older", ["older"]],
    ]);
  });

  it("keeps paging after an empty page and drops files seen on an earlier page", () => {
    const a = file("a", "2026-10-24T08:00:00.000Z");
    const cursor = { createdAt: "2026-10-20T00:00:00.000Z", key: "c" };
    expect(
      mergeBotFilePages([
        { items: [a], nextCursor: cursor },
        { items: [], nextCursor: cursor },
      ]),
    ).toEqual({ files: [a], nextCursor: cursor });
    expect(
      mergeBotFilePages([
        { items: [a], nextCursor: cursor },
        { items: [a], nextCursor: null },
      ]),
    ).toEqual({ files: [a], nextCursor: null });
  });

  it("says schedules the way a person would", () => {
    expect(
      botRoutineScheduleLabel(
        { type: "fixed_time", timeOfDay: "07:30", weekdays: [1, 2, 3, 4, 5] },
        "en-US",
      ),
    ).toBe("Every weekday at 7:30 AM");
    expect(
      botRoutineScheduleLabel(
        { type: "fixed_time", timeOfDay: "18:00", weekdays: [4, 1] },
        "en-US",
      ),
    ).toBe("Mondays and Thursdays at 6:00 PM");
    expect(botRoutineScheduleLabel({ type: "interval", everyMs: 2 * 60 * 60_000 })).toBe(
      "Every 2 hours",
    );
  });

  it("previews html renders through their attachment", () => {
    const render = {
      ...file("page", "2026-10-24T08:00:00.000Z"),
      kind: "html",
      htmlRender: {
        attachmentId: ChatAttachmentId.make("html-1"),
        title: "Trip plan",
        height: 400,
      },
    } as unknown as BotFile;
    expect(botFilePreviewTarget(render)).toMatchObject({
      attachmentId: "html-1",
      mimeType: "text/html",
      htmlRender: true,
    });
  });

  it("only offers initials a project icon can store", () => {
    expect(botInitials("Fitness")).toBe("FI");
    expect(botInitials("Home Assistant")).toBe("HA");
    expect(botInitials("🏋️")).toBeNull();
  });
});
