import {
  type BotFile,
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import {
  matchBotMentionItems,
  mergeBotMentionFiles,
  referencesBotServerCannotRead,
  type BotMentionProjectCandidate,
  type BotMentionThreadCandidate,
} from "./botMentionItems.ts";

const home = EnvironmentId.make("env-home");
const laptop = EnvironmentId.make("env-laptop");
const offline = EnvironmentId.make("env-offline");
const botId = ProjectId.make("bot-researcher");
const now = Date.parse("2026-10-24T12:00:00.000Z");

function shell(
  id: string,
  title: string,
  projectId: string,
  overrides: Partial<BotMentionThreadCandidate> = {},
): BotMentionThreadCandidate {
  return {
    environmentId: home,
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    title,
    branch: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    latestUserMessageAt: null,
    opens: null,
    archivedAt: null,
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
    ...overrides,
  };
}

function project(
  id: string,
  title: string,
  overrides: Partial<BotMentionProjectCandidate> = {},
): BotMentionProjectCandidate {
  return {
    environmentId: home,
    id: ProjectId.make(id),
    title,
    botRole: null,
    botMainThreadId: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const projects = [
  project("bot-researcher", "Researcher", {
    botRole: "specialist",
    botMainThreadId: ThreadId.make("researcher-main"),
  }),
  project("bot-assistant", "Assistant", {
    botRole: "assistant",
    botMainThreadId: ThreadId.make("assistant-main"),
  }),
  project("t3code", "t3code", { updatedAt: at(20) }),
  project("scratch", "Scratch", { isScratch: true }),
  project("laptop-bot", "Researcher", {
    environmentId: laptop,
    botRole: "specialist",
    botMainThreadId: ThreadId.make("laptop-main"),
  }),
  project("offline-project", "Offline repo", { environmentId: offline }),
];

const shells = [
  shell("researcher-main", "Researcher", "bot-researcher", { updatedAt: at(10) }),
  shell("researcher-pricing", "Pricing research", "bot-researcher", { updatedAt: at(5) }),
  shell("researcher-old", "Old pricing notes", "bot-researcher", { archivedAt: at(3) }),
  shell("assistant-main", "Assistant", "bot-assistant", { updatedAt: at(23) }),
  shell("assistant-topic", "Trip planning", "bot-assistant", { updatedAt: at(22) }),
  shell("code-fix", "Fix pricing page", "t3code", { updatedAt: at(21) }),
  shell("scratch-chat", "Quick question", "scratch", { updatedAt: at(19) }),
  shell("subagent", "Pricing subagent", "t3code", {
    updatedAt: at(23),
    lineage: {
      rootThreadId: ThreadId.make("code-fix"),
      parentThreadId: ThreadId.make("code-fix"),
      relationshipToParent: "subagent",
    },
  }),
  shell("laptop-main", "Researcher", "laptop-bot", { environmentId: laptop, updatedAt: at(1) }),
  shell("offline-thread", "Pricing on the offline box", "offline-project", {
    environmentId: offline,
    updatedAt: at(23),
  }),
];

const files: BotFile[] = [
  {
    id: "item:turn-1",
    kind: "html",
    title: "Pricing report",
    createdAt: at(9),
    sourceThreadId: ThreadId.make("researcher-pricing"),
    sourceMessageId: null,
    sourceTurnItemId: TurnItemId.make("turn-1"),
    htmlRender: {
      attachmentId: "researcher-pricing-render-1",
      title: "Pricing report",
      height: 600,
    },
  },
  {
    id: "message:m1:0",
    kind: "attachment",
    title: "competitors.png",
    createdAt: at(8),
    sourceThreadId: ThreadId.make("researcher-main"),
    sourceMessageId: MessageId.make("m1"),
    sourceTurnItemId: null,
    attachment: {
      type: "image",
      id: "researcher-main-image-1",
      name: "competitors.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    },
  },
];

const environments = new Map([
  [home, "Home"],
  [laptop, "Laptop"],
]);

function match(query: string, activeThreadId = "researcher-pricing", serverReadsMentions = true) {
  return matchBotMentionItems({
    serverReadsMentions,
    query,
    now,
    bot: { environmentId: home, projectId: botId },
    activeThreadId: ThreadId.make(activeThreadId),
    shells,
    projects,
    files,
    environments,
  });
}

describe("matchBotMentionItems", () => {
  it("opens with a short grouped list of recent, non-archived context", () => {
    const items = match("");
    expect(items.map((item) => [item.group, item.label, item.description])).toEqual([
      ["files", "Pricing report", "Published page · Pricing research"],
      ["files", "competitors.png", "Image · Researcher"],
      // The bot's own main thread leads; other bots' main threads are offered as bots.
      ["conversations", "Researcher", "Researcher"],
      ["conversations", "Trip planning", "Assistant"],
      ["conversations", "Fix pricing page", "t3code"],
      ["conversations", "Quick question", "Code"],
      ["projects", "t3code", "Project"],
      ["bots", "Assistant", "Assistant"],
      ["bots", "Researcher", "Bot · Laptop"],
    ]);
  });

  it("searches every group, finds archived threads with a label, and skips unreadable machines", () => {
    const items = match("pricing");
    const labels = items.map((item) => `${item.group}:${item.label}:${item.description}`);
    expect(labels).toContain("files:Pricing report:Published page · Pricing research");
    expect(labels).toContain("conversations:Fix pricing page:t3code");
    expect(labels).toContain("conversations:Old pricing notes:Archived · Researcher");
    // The open thread, subagents, and a disconnected environment never appear.
    expect(labels.some((label) => label.includes("Pricing research:Researcher"))).toBe(false);
    expect(labels.some((label) => label.includes("subagent"))).toBe(false);
    expect(labels.some((label) => label.includes("offline"))).toBe(false);
  });

  it("puts the group holding the best match first", () => {
    const items = match("assistant");
    expect(items[0]).toMatchObject({ group: "bots", label: "Assistant" });
  });

  it("never offers the bot itself, scratch projects, or workspace paths", () => {
    const items = match("");
    expect(
      items.some(
        (item) =>
          item.reference.kind === "project" &&
          item.reference.projectId === botId &&
          item.reference.environmentId === home,
      ),
    ).toBe(false);
    expect(items.some((item) => item.label === "Scratch")).toBe(false);
    expect(items.every((item) => item.type === "reference")).toBe(true);
  });

  it("serializes references by environment, project, thread, and stored attachment", () => {
    const items = match("");
    const report = items.find((item) => item.label === "Pricing report")!;
    expect(report.reference).toMatchObject({
      kind: "bot-file",
      environmentId: home,
      projectId: botId,
      fileId: "item:turn-1",
      fileKind: "html",
      attachmentId: "researcher-pricing-render-1",
      mimeType: "text/html",
      sourceThreadId: "researcher-pricing",
      sourceTurnItemId: "turn-1",
    });
    expect(report.reference).not.toHaveProperty("sourceMessageId");

    const remoteBot = items.find((item) => item.description === "Bot · Laptop")!;
    expect(remoteBot.reference).toMatchObject({
      kind: "project",
      environmentId: laptop,
      projectId: "laptop-bot",
      botRole: "specialist",
      mainThreadId: "laptop-main",
    });

    const codeProject = items.find((item) => item.label === "t3code")!;
    expect(codeProject.reference).toMatchObject({ kind: "project", botRole: null });
    expect(codeProject.reference).not.toHaveProperty("mainThreadId");

    const thread = items.find((item) => item.label === "Fix pricing page")!;
    expect(thread.reference).toMatchObject({
      kind: "thread",
      environmentId: home,
      threadId: "code-fix",
      title: "Fix pricing page",
    });
    // Distinct ids so the same name on two machines is two references.
    const ids = items.map((item) => item.reference.contextId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers an older server only threads on its own machine, which it can still read", () => {
    const items = [...match("", "researcher-pricing", false), ...match("pricing", "x", false)];
    expect(items.length).toBeGreaterThan(0);
    expect(
      items.every(
        (item) => item.reference.kind === "thread" && item.reference.environmentId === home,
      ),
    ).toBe(true);
  });
});

describe("mergeBotMentionFiles", () => {
  it("adds Files the server found beyond the newest page, once each", () => {
    const [report, image] = files as [BotFile, BotFile];
    const older: BotFile = { ...report, id: "item:old", title: "Pricing 2024", createdAt: at(1) };
    expect(mergeBotMentionFiles([report, image], [image, older]).map((file) => file.id)).toEqual([
      report.id,
      image.id,
      older.id,
    ]);
    const recent = [report];
    expect(mergeBotMentionFiles(recent, [report])).toBe(recent);
  });

  it("lets a Files search reach an older file the newest page does not hold", () => {
    const older: BotFile = {
      ...files[0]!,
      id: "item:old",
      title: "Churn analysis",
      createdAt: at(1),
    };
    const items = matchBotMentionItems({
      query: "churn",
      now,
      bot: { environmentId: home, projectId: botId },
      activeThreadId: null,
      shells,
      projects,
      files: mergeBotMentionFiles(files, [older]),
      environments,
    });
    expect(items[0]).toMatchObject({ group: "files", label: "Churn analysis" });
  });
});

describe("referencesBotServerCannotRead", () => {
  const items = match("");
  const ref = (label: string) => items.find((item) => item.label === label)!.reference;
  const records = [ref("Pricing report"), ref("t3code"), ref("Fix pricing page")];
  const remoteThread = matchBotMentionItems({
    query: "",
    now,
    bot: { environmentId: laptop, projectId: botId },
    activeThreadId: null,
    shells: [shell("laptop-thread", "Laptop notes", "t3code", { environmentId: laptop })],
    projects: [],
    files: [],
    environments,
  })[0]!.reference;
  const all = [...records, remoteThread];
  const text = all.map((record) => formatComposerContextReference(record)).join(" ");

  it("flags project, bot-file, and other-machine thread references for an older server", () => {
    expect(
      referencesBotServerCannotRead({
        text,
        records: all,
        environmentId: home,
        serverReadsMentions: false,
      }).map((record) => record.label),
    ).toEqual(["Pricing report", "t3code", "Laptop notes"]);
  });

  it("flags nothing for a current server, or references no longer in the text", () => {
    expect(
      referencesBotServerCannotRead({
        text,
        records: all,
        environmentId: home,
        serverReadsMentions: true,
      }),
    ).toEqual([]);
    expect(
      referencesBotServerCannotRead({
        text: "",
        records: all,
        environmentId: home,
        serverReadsMentions: false,
      }),
    ).toEqual([]);
  });
});
