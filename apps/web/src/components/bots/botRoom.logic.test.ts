import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  orderBotConversations,
  partitionEnvironmentBots,
  resolveAssistantEnvironmentId,
  resolveBotsEnvironmentId,
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

describe("partitionEnvironmentBots", () => {
  it("scopes bots to one environment with Assistant apart from sorted specialists", () => {
    const projects = [
      { environmentId: envA, title: "Testing", botRole: "specialist" as const },
      { environmentId: envB, title: "Assistant", botRole: "assistant" as const },
      { environmentId: envA, title: "Assistant", botRole: "assistant" as const },
      { environmentId: envA, title: "Fitness", botRole: "specialist" as const },
      { environmentId: envA, title: "web", botRole: null },
    ];
    const { assistant, specialists } = partitionEnvironmentBots(projects, envA);
    expect(assistant).toBe(projects[2]);
    expect(specialists.map((bot) => bot.title)).toEqual(["Fitness", "Testing"]);
    expect(partitionEnvironmentBots(projects, null)).toEqual({ assistant: null, specialists: [] });
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

describe("resolveBotsEnvironmentId", () => {
  const base = {
    routeBotEnvironmentId: null,
    selectedEnvironmentId: null,
    routeEnvironmentId: null,
    primaryEnvironmentId: null,
    connectedEnvironmentIds: [envA, envB],
  };

  it("prefers the routed bot, then a connected selection, the routed thread, and the primary", () => {
    expect(resolveBotsEnvironmentId({ ...base, routeBotEnvironmentId: envB })).toBe(envB);
    expect(
      resolveBotsEnvironmentId({ ...base, selectedEnvironmentId: envB, routeEnvironmentId: envA }),
    ).toBe(envB);
    expect(resolveBotsEnvironmentId({ ...base, routeEnvironmentId: envB })).toBe(envB);
    expect(resolveBotsEnvironmentId({ ...base, primaryEnvironmentId: envB })).toBe(envB);
    expect(resolveBotsEnvironmentId(base)).toBe(envA);
  });

  it("skips a disconnected selection", () => {
    expect(
      resolveBotsEnvironmentId({
        ...base,
        selectedEnvironmentId: EnvironmentId.make("env-gone"),
        connectedEnvironmentIds: [envB],
      }),
    ).toBe(envB);
    expect(resolveBotsEnvironmentId({ ...base, connectedEnvironmentIds: [] })).toBeNull();
  });
});

describe("resolveAssistantEnvironmentId", () => {
  it("follows the Code work on screen over the environment Bots was left on", () => {
    const input = {
      routeEnvironmentId: envB,
      selectedEnvironmentId: envA,
      primaryEnvironmentId: envA,
      connectedEnvironmentIds: [envA, envB],
    };
    expect(resolveAssistantEnvironmentId(input)).toBe(envB);
    // The Bots room keeps its own selection for the same route.
    expect(resolveBotsEnvironmentId({ ...input, routeBotEnvironmentId: null })).toBe(envA);
  });

  it("stays on the work's environment while it is offline", () => {
    expect(
      resolveAssistantEnvironmentId({
        routeEnvironmentId: envA,
        selectedEnvironmentId: envB,
        primaryEnvironmentId: envB,
        connectedEnvironmentIds: [envB],
      }),
    ).toBe(envA);
  });

  it("off a thread, falls back to the connected Bots selection, then the primary", () => {
    const base = {
      routeEnvironmentId: null,
      selectedEnvironmentId: null,
      primaryEnvironmentId: envA,
      connectedEnvironmentIds: [envA, envB],
    };
    expect(resolveAssistantEnvironmentId({ ...base, selectedEnvironmentId: envB })).toBe(envB);
    expect(resolveAssistantEnvironmentId(base)).toBe(envA);
    expect(
      resolveAssistantEnvironmentId({
        ...base,
        selectedEnvironmentId: EnvironmentId.make("env-gone"),
        primaryEnvironmentId: null,
        connectedEnvironmentIds: [envB],
      }),
    ).toBe(envB);
    expect(resolveAssistantEnvironmentId({ ...base, connectedEnvironmentIds: [] })).toBeNull();
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
