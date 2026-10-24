import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { botProjectKeys, botThreadStatus, buildBotRoom, isBotThread } from "./bot-room";

const HOME = EnvironmentId.make("home");
const WORK = EnvironmentId.make("work");

function project(
  input: Partial<EnvironmentProject> & Pick<EnvironmentProject, "environmentId" | "id" | "title">,
): EnvironmentProject {
  return {
    workspaceRoot: `/bots/${input.id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...input,
  };
}

function thread(
  input: Partial<EnvironmentThreadShell> &
    Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">,
): EnvironmentThreadShell {
  return makeThreadShellFixture({
    title: input.id,
    archivedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...input,
  });
}

const assistant = project({
  environmentId: HOME,
  id: ProjectId.make("assistant"),
  title: "Home assistant",
  botRole: "assistant",
  botMainThreadId: ThreadId.make("assistant-main"),
});
const fitness = project({
  environmentId: HOME,
  id: ProjectId.make("fitness"),
  title: "Fitness",
  botRole: "specialist",
  botMainThreadId: ThreadId.make("fitness-main"),
});
const finance = project({
  environmentId: HOME,
  id: ProjectId.make("finance"),
  title: "Finance",
  botRole: "specialist",
  botMainThreadId: null,
});
const code = project({ environmentId: HOME, id: ProjectId.make("web"), title: "acme/web" });

describe("bots room", () => {
  it("leads every environment with its Assistant, even before one exists", () => {
    const room = buildBotRoom({
      environments: [
        { environmentId: HOME, label: "Home" },
        { environmentId: WORK, label: "Work" },
      ],
      projects: [fitness, code, assistant, finance],
      threads: [],
    });
    expect(room.map((environment) => environment.assistant.project?.id ?? null)).toEqual([
      assistant.id,
      null,
    ]);
    // A renamed Assistant goes by its name; one not created yet goes by its role.
    expect(room.map((environment) => environment.assistant.title)).toEqual([
      "Home assistant",
      "Assistant",
    ]);
    expect(room[0]!.specialists.map((bot) => bot.title)).toEqual(["Finance", "Fitness"]);
    expect(room[1]!.specialists).toEqual([]);
  });

  it("separates the main conversation from topics and keeps archived topics out", () => {
    const [environment] = buildBotRoom({
      environments: [{ environmentId: HOME, label: "Home" }],
      projects: [fitness],
      threads: [
        thread({ environmentId: HOME, id: ThreadId.make("fitness-main"), projectId: fitness.id }),
        thread({
          environmentId: HOME,
          id: ThreadId.make("older"),
          projectId: fitness.id,
          updatedAt: "2026-10-02T00:00:00.000Z",
        }),
        thread({
          environmentId: HOME,
          id: ThreadId.make("newer"),
          projectId: fitness.id,
          updatedAt: "2026-10-03T00:00:00.000Z",
        }),
        thread({
          environmentId: HOME,
          id: ThreadId.make("archived"),
          projectId: fitness.id,
          archivedAt: "2026-10-04T00:00:00.000Z",
        }),
        // Same project id in another environment belongs to another bot.
        thread({ environmentId: WORK, id: ThreadId.make("elsewhere"), projectId: fitness.id }),
      ],
    });
    const [bot] = environment!.specialists;
    expect(bot!.mainThread?.id).toBe("fitness-main");
    expect(bot!.topics.map((topic) => topic.id)).toEqual(["newer", "older"]);
  });

  it("keeps bot threads out of Code without touching ordinary projects", () => {
    const keys = botProjectKeys([assistant, fitness, code]);
    expect(isBotThread(keys, { environmentId: HOME, projectId: fitness.id })).toBe(true);
    expect(isBotThread(keys, { environmentId: HOME, projectId: code.id })).toBe(false);
    expect(isBotThread(keys, { environmentId: WORK, projectId: fitness.id })).toBe(false);
  });

  it("asks for the user before reporting work in progress", () => {
    const base = thread({ environmentId: HOME, id: ThreadId.make("t"), projectId: fitness.id });
    expect(botThreadStatus(base)).toBeNull();
    expect(botThreadStatus({ ...base, hasPendingUserInput: true })).toBe("needs-you");
  });
});
