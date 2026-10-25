import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  archivedBotThreads,
  buildBotsCollection,
  commitBotThreadRename,
  type BotThreadRenameProblem,
  matchesBotThreadQuery,
  orderBotConversations,
  partitionEnvironmentBots,
  resolveBotsRoomEntry,
  resolveRoom,
  withoutBotProjects,
} from "./botRoom.logic";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

describe("resolveRoom", () => {
  it("follows the routed thread's project and holds the previous room while it loads", () => {
    const bot = { kind: "project", project: { botRole: "specialist" } } as const;
    const code = { kind: "project", project: { botRole: null } } as const;
    expect(resolveRoom({ pathname: "/a/b", routeProject: bot, previousRoom: "code" })).toBe("bots");
    expect(resolveRoom({ pathname: "/a/b", routeProject: code, previousRoom: "bots" })).toBe(
      "code",
    );
    expect(
      resolveRoom({ pathname: "/a/b", routeProject: { kind: "pending" }, previousRoom: "bots" }),
    ).toBe("bots");
    expect(
      resolveRoom({ pathname: "/bots", routeProject: { kind: "none" }, previousRoom: "code" }),
    ).toBe("bots");
    expect(
      resolveRoom({ pathname: "/usage", routeProject: { kind: "none" }, previousRoom: "bots" }),
    ).toBe("code");
  });
});

describe("withoutBotProjects", () => {
  it("keeps the input identity when there are no bots", () => {
    const projects = [{ botRole: null }, {}];
    expect(withoutBotProjects(projects)).toBe(projects);
    expect(withoutBotProjects([...projects, { botRole: "assistant" as const }])).toEqual(projects);
  });
});

const bot = (
  environmentId: EnvironmentId,
  id: string,
  title: string,
  botRole: "assistant" | "specialist" | null,
  createdAt = "2026-01-01",
) => ({ environmentId, id, title, botRole, createdAt });

describe("partitionEnvironmentBots", () => {
  it("scopes bots to one environment: its oldest Assistant, any extra Assistants, sorted specialists", () => {
    const projects = [
      bot(envA, "t", "Testing", "specialist"),
      bot(envB, "b-a", "Assistant", "assistant"),
      bot(envA, "a-new", "Assistant", "assistant", "2026-06-01"),
      bot(envA, "a-old", "Assistant", "assistant", "2026-02-01"),
      bot(envA, "f", "Fitness", "specialist"),
      bot(envA, "w", "web", null),
    ];
    const { assistant, extraAssistants, specialists } = partitionEnvironmentBots(projects, envA);
    expect(assistant).toBe(projects[3]);
    expect(extraAssistants).toEqual([projects[2]]);
    expect(specialists.map((entry) => entry.title)).toEqual(["Fitness", "Testing"]);
    expect(partitionEnvironmentBots(projects, null)).toEqual({
      assistant: null,
      extraAssistants: [],
      specialists: [],
    });
  });
});

describe("buildBotsCollection", () => {
  const envC = EnvironmentId.make("env-c");
  const environments = [
    { environmentId: envA, label: "Desk", connected: true },
    { environmentId: envB, label: "Laptop", connected: false },
  ];

  it("lists every environment's bots once, leading with the designated Assistant", () => {
    const projects = [
      bot(envA, "a", "Assistant", "assistant", "2026-01-01"),
      bot(envA, "fit", "Fitness", "specialist"),
      bot(envB, "b", "Assistant", "assistant", "2026-03-01"),
      bot(envB, "fin", "Finance", "specialist"),
      bot(envA, "web", "web", null),
      bot(envC, "unknown", "Elsewhere", "specialist"),
    ];
    const collection = buildBotsCollection({
      projects,
      environments,
      assistantEnvironmentId: envA,
      query: "",
    });
    expect(collection.assistant).toEqual({
      environmentId: envA,
      project: projects[0],
      hostLabel: null,
      offline: false,
    });
    // An environment that is offline keeps its cached bots, marked offline and not relabelled.
    expect(
      collection.specialists.map((entry) => [entry.project?.title, entry.hostLabel, entry.offline]),
    ).toEqual([
      ["Finance", null, true],
      ["Fitness", null, false],
    ]);
    // Another environment's Assistant stays reachable, always with its host.
    expect(collection.otherAssistants.map((entry) => [entry.project?.id, entry.hostLabel])).toEqual(
      [["b", "Laptop"]],
    );
  });

  it("keeps an extra Assistant on the designated environment instead of hiding it", () => {
    const older = bot(envA, "old", "Assistant", "assistant", "2026-01-01");
    const newer = bot(envA, "new", "Assistant", "assistant", "2026-05-01");
    const collection = buildBotsCollection({
      projects: [newer, older],
      environments,
      assistantEnvironmentId: envA,
      query: "",
    });
    expect(collection.assistant?.project).toBe(older);
    expect(collection.otherAssistants.map((entry) => entry.project)).toEqual([newer]);
  });

  it("leads with an Assistant opening will create, and nothing for an unknown environment", () => {
    expect(
      buildBotsCollection({
        projects: [],
        environments,
        assistantEnvironmentId: envA,
        query: "",
      }).assistant,
    ).toEqual({ environmentId: envA, project: null, hostLabel: null, offline: false });
    expect(
      buildBotsCollection({ projects: [], environments, assistantEnvironmentId: envC, query: "" })
        .assistant,
    ).toBeNull();
  });

  it("labels hosts only where names collide across environments", () => {
    const collection = buildBotsCollection({
      projects: [
        bot(envA, "fa", "Fitness", "specialist"),
        bot(envB, "fb", " fitness ", "specialist"),
        bot(envA, "fa2", "Finance", "specialist"),
      ],
      environments,
      assistantEnvironmentId: envA,
      query: "",
    });
    expect(
      Object.fromEntries(
        collection.specialists.map((entry) => [entry.project?.id, entry.hostLabel]),
      ),
    ).toEqual({ fa: "Desk", fb: "Laptop", fa2: null });
  });

  it("filters every group by name", () => {
    const collection = buildBotsCollection({
      projects: [
        bot(envA, "a", "Assistant", "assistant"),
        bot(envA, "fit", "Fitness", "specialist"),
        bot(envB, "b", "Assistant", "assistant", "2026-04-01"),
      ],
      environments,
      assistantEnvironmentId: envA,
      query: " ASSIST",
    });
    expect(collection.assistant?.project?.id).toBe("a");
    expect(collection.specialists).toEqual([]);
    expect(collection.otherAssistants.map((entry) => entry.project?.id)).toEqual(["b"]);
  });
});

describe("orderBotConversations", () => {
  it("separates the main conversation, keeping it even when archived, and drops archived topics", () => {
    const thread = (id: string, updatedAt: string, archivedAt: string | null = null) => ({
      id: ThreadId.make(id),
      updatedAt,
      archivedAt,
    });
    const main = thread("main", "2026-01-01", "2026-01-02");
    const { main: resolvedMain, topics } = orderBotConversations(
      [
        thread("old", "2026-01-01"),
        main,
        thread("gone", "2026-01-05", "x"),
        thread("new", "2026-01-04"),
      ],
      ThreadId.make("main"),
    );
    expect(resolvedMain).toBe(main);
    expect(topics.map((topic) => topic.id)).toEqual(["new", "old"]);
  });
});

describe("archivedBotThreads", () => {
  it("lists only this bot's archived threads, newest archive first, never its main", () => {
    const thread = (id: string, projectId: string, archivedAt: string | null) => ({
      id: ThreadId.make(id),
      projectId,
      archivedAt,
    });
    const archived = archivedBotThreads(
      [
        thread("older", "bot", "2026-01-02"),
        thread("main", "bot", "2026-01-09"),
        thread("open", "bot", null),
        thread("other-bot", "other", "2026-01-08"),
        thread("newer", "bot", "2026-01-05"),
      ],
      "bot",
      ThreadId.make("main"),
    );
    expect(archived.map((entry) => entry.id)).toEqual(["newer", "older"]);
  });
});

describe("matchesBotThreadQuery", () => {
  it("matches titles case-insensitively and treats a blank query as everything", () => {
    expect(matchesBotThreadQuery("Trip planning", "  ")).toBe(true);
    expect(matchesBotThreadQuery("Trip planning", "PLAN")).toBe(true);
    expect(matchesBotThreadQuery("Trip planning", "budget")).toBe(false);
  });
});

describe("resolveBotsRoomEntry", () => {
  const live = { deletedAt: null, archivedAt: null };
  const mainRef = scopeThreadRef(envA, ThreadId.make("assistant-main"));
  const assistantMain = { threadRef: mainRef, thread: live };

  it("returns to a saved conversation that still exists, even before the shell is live", () => {
    expect(
      resolveBotsRoomEntry({
        saved: { kind: "thread", thread: { deletedAt: null, archivedAt: "2026-01-01" } },
        shellAuthoritative: false,
        assistantMain,
      }),
    ).toEqual({ entry: { kind: "saved" }, pruneSaved: false });
  });

  it("forgets a deleted saved conversation and lands on Assistant's main instead", () => {
    for (const thread of [null, { deletedAt: "2026-01-02", archivedAt: null }]) {
      expect(
        resolveBotsRoomEntry({
          saved: { kind: "thread", thread },
          shellAuthoritative: true,
          assistantMain,
        }),
      ).toEqual({ entry: { kind: "thread", threadRef: mainRef }, pruneSaved: true });
    }
    expect(
      resolveBotsRoomEntry({
        saved: { kind: "draft", exists: false },
        shellAuthoritative: false,
        assistantMain: null,
      }),
    ).toEqual({ entry: { kind: "home" }, pruneSaved: true });
  });

  it("keeps an unconfirmed saved conversation while the shell loads, without following it", () => {
    expect(
      resolveBotsRoomEntry({
        saved: { kind: "thread", thread: null },
        shellAuthoritative: false,
        assistantMain,
      }),
    ).toEqual({ entry: { kind: "home" }, pruneSaved: false });
  });

  it("never lands on an archived or unloaded main, since unarchiving is a write", () => {
    for (const thread of [null, { deletedAt: null, archivedAt: "2026-01-01" }]) {
      expect(
        resolveBotsRoomEntry({
          saved: null,
          shellAuthoritative: true,
          assistantMain: { threadRef: mainRef, thread },
        }),
      ).toEqual({ entry: { kind: "home" }, pruneSaved: false });
    }
  });
});

describe("commitBotThreadRename", () => {
  const commit = (options: {
    title: string;
    canOperate?: boolean;
    result?: AtomCommandResult<unknown, unknown>;
  }) => {
    const saved: string[] = [];
    const problems: BotThreadRenameProblem["kind"][] = [];
    const accepted = commitBotThreadRename({
      title: options.title,
      currentTitle: "Research",
      canOperate: () => options.canOperate ?? true,
      save: async (title) => {
        saved.push(title);
        return options.result ?? AsyncResult.success(undefined);
      },
      report: (problem) => problems.push(problem.kind),
    });
    return accepted.then((value) => ({ accepted: value, saved, problems }));
  };

  it("saves the trimmed title and closes the editor", async () => {
    expect(await commit({ title: "  Launch plan " })).toEqual({
      accepted: true,
      saved: ["Launch plan"],
      problems: [],
    });
  });

  it("keeps the editor open when the save fails", async () => {
    expect(
      await commit({ title: "Launch plan", result: AsyncResult.failure(Cause.fail("offline")) }),
    ).toEqual({ accepted: false, saved: ["Launch plan"], problems: ["failed"] });
  });

  it("keeps the editor open without a toast when the save is interrupted", async () => {
    expect(
      await commit({ title: "Launch plan", result: AsyncResult.failure(Cause.interrupt()) }),
    ).toEqual({ accepted: false, saved: ["Launch plan"], problems: [] });
  });

  it("does not claim success once permission is lost", async () => {
    expect(await commit({ title: "Launch plan", canOperate: false })).toEqual({
      accepted: false,
      saved: [],
      problems: ["forbidden"],
    });
  });

  it("rejects an empty title and closes on an unchanged one without saving", async () => {
    expect(await commit({ title: "   " })).toEqual({
      accepted: false,
      saved: [],
      problems: ["empty"],
    });
    expect(await commit({ title: "Research ", canOperate: false })).toEqual({
      accepted: true,
      saved: [],
      problems: [],
    });
  });
});
