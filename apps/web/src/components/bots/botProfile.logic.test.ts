import { BotFile } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  botFilePreviewTarget,
  botFileTitle,
  botFileVisual,
  botRoutineScheduleLabel,
  groupBotFiles,
} from "./botProfile.logic";

const decodeFile = Schema.decodeUnknownSync(BotFile);

function attachmentFile(
  id: string,
  createdAt: string,
  attachment: { type: string; name: string; mimeType: string },
  title = "",
) {
  return decodeFile({
    id,
    title,
    createdAt,
    sourceThreadId: "thread-1",
    sourceMessageId: null,
    sourceTurnItemId: null,
    kind: "attachment",
    attachment: { id: `att-${id}`, sizeBytes: 10, ...attachment },
  });
}

function htmlFile(id: string, createdAt: string, title: string) {
  return decodeFile({
    id,
    title,
    createdAt,
    sourceThreadId: "thread-1",
    sourceMessageId: null,
    sourceTurnItemId: null,
    kind: "html",
    htmlRender: { attachmentId: `att-${id}`, title, height: 400 },
  });
}

describe("botRoutineScheduleLabel", () => {
  it("says fixed times on a 12-hour clock with plain day names", () => {
    const at = (timeOfDay: string, weekdays?: number[]) =>
      botRoutineScheduleLabel(
        { type: "fixed_time", timeOfDay, ...(weekdays ? { weekdays } : {}) },
        "en-US",
      );
    expect(at("07:30", [1, 2, 3, 4, 5])).toBe("Every weekday at 7:30 AM");
    expect(at("18:00", [4, 1])).toBe("Mondays and Thursdays at 6:00 PM");
    expect(at("09:00")).toBe("Every day at 9:00 AM");
    expect(at("09:00", [0, 1, 2, 3, 4, 5, 6])).toBe("Every day at 9:00 AM");
    expect(at("10:15", [6, 0])).toBe("Weekends at 10:15 AM");
    expect(at("08:00", [1, 3, 5])).toBe("Mondays, Wednesdays and Fridays at 8:00 AM");
  });

  it("rounds intervals to the largest whole unit", () => {
    const every = (everyMs: number) => botRoutineScheduleLabel({ type: "interval", everyMs });
    expect(every(60_000)).toBe("Every minute");
    expect(every(30 * 60_000)).toBe("Every 30 minutes");
    expect(every(90 * 60_000)).toBe("Every 90 minutes");
    expect(every(60 * 60_000)).toBe("Every hour");
    expect(every(6 * 60 * 60_000)).toBe("Every 6 hours");
    expect(every(24 * 60 * 60_000)).toBe("Every day");
    expect(every(3 * 24 * 60 * 60_000)).toBe("Every 3 days");
  });

  it("never exposes webhook details", () => {
    expect(botRoutineScheduleLabel({ type: "webhook", signature: null })).toBe(
      "When another app asks",
    );
  });
});

describe("groupBotFiles", () => {
  it("splits newest-first files into today, the past week, and older, skipping empty groups", () => {
    const now = new Date(2026, 9, 24, 15, 0).getTime();
    const iso = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString();
    const files = [
      attachmentFile("a", iso(24, 8), { type: "image", name: "a.png", mimeType: "image/png" }),
      attachmentFile("b", iso(23), { type: "image", name: "b.png", mimeType: "image/png" }),
      attachmentFile("c", iso(18, 0), { type: "image", name: "c.png", mimeType: "image/png" }),
      attachmentFile("d", iso(17, 23), { type: "image", name: "d.png", mimeType: "image/png" }),
    ];
    expect(
      groupBotFiles(files, now).map((group) => [group.label, group.files.map((file) => file.id)]),
    ).toEqual([
      ["Today", ["a"]],
      ["This week", ["b", "c"]],
      ["Older", ["d"]],
    ]);
    expect(groupBotFiles(files.slice(3), now).map((group) => group.label)).toEqual(["Older"]);
  });
});

describe("bot file presentation", () => {
  const createdAt = "2026-10-24T08:00:00.000Z";

  it("names files by the server title, falling back to the shared name", () => {
    const named = attachmentFile(
      "a",
      createdAt,
      { type: "file", name: "q3.csv", mimeType: "text/csv" },
      "Q3 spending",
    );
    const unnamed = attachmentFile("b", createdAt, {
      type: "file",
      name: "q3.csv",
      mimeType: "text/csv",
    });
    expect(botFileTitle(named)).toBe("Q3 spending");
    expect(botFileTitle(unnamed)).toBe("q3.csv");
    expect(botFileVisual(named)).toBe("table");
  });

  it("previews a rendered page through its stored HTML attachment", () => {
    const page = htmlFile("p", createdAt, "Lisbon flights");
    expect(botFileVisual(page)).toBe("page");
    expect(botFilePreviewTarget(page)).toMatchObject({
      attachmentId: "att-p",
      mimeType: "text/html",
      htmlRender: true,
    });
  });

  it("recognizes documents and images by type, not just extension", () => {
    expect(
      botFileVisual(
        attachmentFile("r", createdAt, {
          type: "file",
          name: "receipt",
          mimeType: "application/pdf",
        }),
      ),
    ).toBe("document");
    expect(
      botFileVisual(
        attachmentFile("i", createdAt, { type: "image", name: "shot", mimeType: "image/png" }),
      ),
    ).toBe("image");
    expect(
      botFileVisual(
        attachmentFile("z", createdAt, {
          type: "file",
          name: "a.zip",
          mimeType: "application/zip",
        }),
      ),
    ).toBe("file");
  });
});
