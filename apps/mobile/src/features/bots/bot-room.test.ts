import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, MessageId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { makeThreadShellFixture } from "../../test-fixtures";
import {
  botProjectKeys,
  botSecondaryThreadCount,
  botThreadStatus,
  buildBotInbox,
  buildBotRoom,
  buildBotThreadList,
  isBotThread,
} from "./bot-room";

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

  it("lists a bot's threads around its main conversation, with archived ones apart", () => {
    const fitnessThread = (id: string, input: Partial<EnvironmentThreadShell> = {}) =>
      thread({ environmentId: HOME, id: ThreadId.make(id), projectId: fitness.id, ...input });
    const list = buildBotThreadList({
      project: fitness,
      threads: [
        fitnessThread("fitness-main"),
        fitnessThread("squats", { title: "Squat form", updatedAt: "2026-10-02T00:00:00.000Z" }),
        fitnessThread("meals", { title: "Meal plan", updatedAt: "2026-10-03T00:00:00.000Z" }),
        // Reopened since the archive snapshot was taken.
        fitnessThread("reopened", { title: "Reopened plan" }),
        thread({ environmentId: HOME, id: ThreadId.make("budget"), projectId: finance.id }),
      ],
      archived: [
        fitnessThread("old-plan", { title: "Old plan", archivedAt: "2026-10-04T00:00:00.000Z" }),
        fitnessThread("older-plan", {
          title: "Older plan",
          archivedAt: "2026-10-02T00:00:00.000Z",
        }),
        fitnessThread("reopened", {
          title: "Reopened plan",
          archivedAt: "2026-10-05T00:00:00.000Z",
        }),
        // Another environment's bot can share the project id.
        thread({
          environmentId: WORK,
          id: ThreadId.make("work-plan"),
          projectId: fitness.id,
          archivedAt: "2026-10-05T00:00:00.000Z",
        }),
      ],
      query: "",
    });
    expect(list.main?.id).toBe("fitness-main");
    expect(list.active.map((entry) => entry.id)).toEqual(["meals", "squats", "reopened"]);
    expect(list.archived.map((entry) => entry.id)).toEqual(["old-plan", "older-plan"]);

    const searched = buildBotThreadList({
      project: fitness,
      threads: [fitnessThread("fitness-main"), fitnessThread("meals", { title: "Meal plan" })],
      archived: [
        fitnessThread("old", { title: "Old PLAN", archivedAt: "2026-10-04T00:00:00.000Z" }),
      ],
      query: " plan ",
    });
    // Search narrows threads, never the main conversation.
    expect(searched.main?.id).toBe("fitness-main");
    expect(searched.active.map((entry) => entry.id)).toEqual(["meals"]);
    expect(searched.archived.map((entry) => entry.id)).toEqual(["old"]);
  });
});

function run(
  status: NonNullable<EnvironmentThreadShell["latestRun"]>["status"],
  at: string,
): EnvironmentThreadShell["latestRun"] {
  const terminal = status === "completed" || status === "failed" || status === "interrupted";
  return {
    runId: RunId.make(`run-${at}`),
    status,
    requestedAt: at,
    startedAt: at,
    completedAt: terminal ? at : null,
    assistantMessageId: null,
  };
}

describe("bots inbox", () => {
  const online = (environmentId: EnvironmentId, label: string) => ({
    environmentId,
    label,
    connected: true,
  });
  const workAssistant = project({
    environmentId: WORK,
    id: ProjectId.make("work-assistant"),
    title: "Assistant",
    botRole: "assistant",
    botMainThreadId: ThreadId.make("work-assistant-main"),
  });

  it("shows one pinned Assistant without legacy Assistants in the inbox", () => {
    const inbox = buildBotInbox({
      environments: [online(HOME, "Home"), online(WORK, "Studio")],
      projects: [assistant, workAssistant, fitness],
      threads: [],
      assistantEnvironmentId: HOME,
      unsentByThreadKey: {},
      query: "",
    });
    expect(inbox.hero?.bot.project?.id).toBe(assistant.id);
    expect(inbox.hero?.hostLabel).toBeNull();
    const rows = inbox.rows.map((row) => [row.bot.title, row.hostLabel]);
    expect(rows).not.toContainEqual(["Assistant", "Studio"]);
    expect(rows).toContainEqual(["Fitness", null]);
    expect(rows).toHaveLength(1);
  });

  it("keeps a second Assistant out of the inbox without deleting it", () => {
    const duplicate = project({
      environmentId: HOME,
      id: ProjectId.make("assistant-duplicate"),
      title: "Home assistant",
      botRole: "assistant",
      botMainThreadId: ThreadId.make("assistant-duplicate-main"),
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    const inbox = buildBotInbox({
      environments: [online(HOME, "Home"), online(WORK, "Studio")],
      projects: [duplicate, assistant, fitness],
      threads: [
        thread({ environmentId: HOME, id: ThreadId.make("dup-topic"), projectId: duplicate.id }),
      ],
      assistantEnvironmentId: HOME,
      unsentByThreadKey: {},
      query: "",
    });
    // The older one is the hero, as the server opens it.
    expect(inbox.hero?.bot.project?.id).toBe(assistant.id);
    const row = inbox.rows.find((entry) => entry.bot.project?.id === duplicate.id);
    expect(row).toBeUndefined();
    expect(inbox.rows).toHaveLength(1);
  });

  it("offers a not-yet-created Assistant as the hero but never as a row", () => {
    const chosenWork = buildBotInbox({
      environments: [online(HOME, "Home"), online(WORK, "Studio")],
      projects: [fitness],
      threads: [],
      assistantEnvironmentId: WORK,
      unsentByThreadKey: {},
      query: "",
    });
    expect(chosenWork.hero?.bot.project).toBeNull();
    expect(chosenWork.hero?.preview).toBe("Start a conversation");
    expect(chosenWork.rows.map((row) => row.bot.title)).toEqual(["Fitness"]);

    // With no environment chosen, an Assistant that already exists leads.
    const unchosen = buildBotInbox({
      environments: [online(HOME, "Home"), online(WORK, "Studio")],
      projects: [workAssistant],
      threads: [],
      assistantEnvironmentId: null,
      unsentByThreadKey: {},
      query: "",
    });
    expect(unchosen.hero?.bot.project?.id).toBe(workAssistant.id);
    expect(unchosen.rows).toEqual([]);
  });

  it("orders bots by their main conversation's latest activity", () => {
    const sleep = project({
      environmentId: HOME,
      id: ProjectId.make("sleep"),
      title: "Sleep",
      botRole: "specialist",
      botMainThreadId: ThreadId.make("sleep-main"),
    });
    const inbox = buildBotInbox({
      environments: [online(HOME, "Home")],
      projects: [assistant, fitness, finance, sleep],
      threads: [
        thread({
          environmentId: HOME,
          id: ThreadId.make("fitness-main"),
          projectId: fitness.id,
          latestUserMessageAt: "2026-10-02T00:00:00.000Z",
        }),
        thread({
          environmentId: HOME,
          id: ThreadId.make("sleep-main"),
          projectId: sleep.id,
          latestRun: run("completed", "2026-10-03T00:00:00.000Z"),
        }),
        // A busy thread besides the main conversation doesn't move the row.
        thread({
          environmentId: HOME,
          id: ThreadId.make("fitness-side"),
          projectId: fitness.id,
          latestUserMessageAt: "2026-10-09T00:00:00.000Z",
        }),
      ],
      assistantEnvironmentId: HOME,
      unsentByThreadKey: {},
      query: "",
    });
    expect(inbox.rows.map((row) => row.bot.title)).toEqual(["Sleep", "Fitness", "Finance"]);
    expect(inbox.rows.map((row) => row.activityAt)).toEqual([
      "2026-10-03T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      null,
    ]);
  });

  it("reports status honestly, surfacing a thread that needs the user", () => {
    const main = (input: Partial<EnvironmentThreadShell>) =>
      thread({
        environmentId: HOME,
        id: ThreadId.make("fitness-main"),
        projectId: fitness.id,
        ...input,
      });
    const side = thread({
      environmentId: HOME,
      id: ThreadId.make("squats"),
      projectId: fitness.id,
      title: "Squat form",
      hasPendingApprovals: true,
    });
    const entry = (threads: EnvironmentThreadShell[], connected = true) =>
      buildBotInbox({
        environments: [{ environmentId: HOME, label: "Home", connected }],
        projects: [assistant, fitness],
        threads,
        assistantEnvironmentId: HOME,
        unsentByThreadKey: {},
        query: "",
      }).rows[0]!;

    const working = main({ latestRun: run("running", "2026-10-02T00:00:00.000Z") });
    expect(entry([working]).status).toBe("working");
    // Nothing a disconnected host runs reads as working.
    expect(entry([working], false).status).toBe("offline");

    const waiting = entry([main({}), side]);
    expect(waiting.status).toBe("needs-you");
    expect(waiting.needsAttention).toBe(true);
    expect(entry([main({}), side], false).needsAttention).toBe(true);
    expect(waiting.needsThread?.title).toBe("Squat form");
    expect(waiting.previewThread?.id).toBe(side.id);

    const mainWaiting = entry([main({ hasPendingUserInput: true }), side]);
    expect(mainWaiting.status).toBe("needs-you");
    expect(mainWaiting.needsThread).toBeNull();
    expect(mainWaiting.previewThread?.id).toBe(ThreadId.make("fitness-main"));
    const unreadSide = {
      ...side,
      hasPendingApprovals: false,
      latestRun: run("completed", "2026-10-02T00:00:00.000Z"),
      lastVisitedAt: "2026-10-01T00:00:00.000Z",
    };
    const mainNeedsInput = entry([main({ hasPendingUserInput: true }), unreadSide]);
    expect(mainNeedsInput.previewThread?.id).toBe(ThreadId.make("fitness-main"));
    expect(mainNeedsInput.preview).not.toContain("Squat form");
    const unread = entry([main({}), unreadSide]);
    expect(unread.unread).toBe(true);
    expect(unread.needsAttention).toBe(false);
    expect(unread.preview).toBe("↳ Squat form · New reply");
    expect(unread.previewThread?.id).toBe(unreadSide.id);
  });

  it("previews what the shell knows, never inventing a message", () => {
    const preview = (input: Partial<EnvironmentThreadShell>, projects = [assistant, fitness]) =>
      buildBotInbox({
        environments: [online(HOME, "Home")],
        projects,
        threads: [
          thread({
            environmentId: HOME,
            id: ThreadId.make("fitness-main"),
            projectId: fitness.id,
            ...input,
          }),
        ],
        assistantEnvironmentId: HOME,
        unsentByThreadKey: {},
        query: "",
      }).rows[0]!;
    const at = "2026-10-02T00:00:00.000Z";

    expect(preview({}).preview).toBe("No messages yet");
    expect(preview({ latestRun: run("completed", at) }).preview).toBe("Replied");
    expect(preview({ latestRun: run("failed", at) }).preview).toBe("Last reply failed");
    expect(preview({ latestRun: run("interrupted", at) }).preview).toBe("Stopped");
    expect(preview({ latestRun: run("running", at) }).preview).toBeNull();

    const unseen = preview({
      latestRun: run("completed", at),
      lastVisitedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(unseen.unread).toBe(true);
    expect(unseen.preview).toBe("New reply");

    const base = thread({
      environmentId: HOME,
      id: ThreadId.make("fitness-main"),
      projectId: fitness.id,
    });
    const withText = preview({
      source: {
        ...base.source,
        latestVisibleMessage: {
          id: MessageId.make("m1"),
          role: "assistant",
          text: "  Rest day\n tomorrow.  ",
          updatedAt: DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"),
        },
      },
      latestRun: run("completed", at),
    });
    expect(withText.preview).toBe("Rest day tomorrow.");
    expect(withText.activityAt).toBe("2026-10-05T00:00:00.000Z");

    // The project names a main conversation the shells don't have: archived or gone.
    const archived = buildBotInbox({
      environments: [online(HOME, "Home")],
      projects: [assistant, fitness],
      threads: [],
      assistantEnvironmentId: HOME,
      unsentByThreadKey: {},
      query: "",
    }).rows[0]!;
    expect(archived.preview).toBe("Reopen conversation");
  });

  it("counts what this device still holds for a bot's main conversation", () => {
    const inbox = buildBotInbox({
      environments: [{ environmentId: HOME, label: "Home", connected: false }],
      projects: [assistant, fitness],
      threads: [],
      assistantEnvironmentId: HOME,
      unsentByThreadKey: {
        [scopedThreadKey(HOME, ThreadId.make("fitness-main"))]: [{}, {}],
        // A secondary thread's outbox belongs to that thread, not the row.
        [scopedThreadKey(HOME, ThreadId.make("squats"))]: [{}],
      },
      query: "",
    });
    expect(inbox.hero?.unsent).toBe(0);
    expect(inbox.rows[0]).toMatchObject({ status: "offline", unsent: 2 });
  });

  it("labels hosts only where names collide across environments", () => {
    const workFitness = project({
      environmentId: WORK,
      id: ProjectId.make("work-fitness"),
      title: "fitness ",
      botRole: "specialist",
    });
    const inbox = buildBotInbox({
      environments: [online(HOME, "Home"), online(WORK, "Studio")],
      projects: [assistant, fitness, finance, workFitness],
      threads: [],
      assistantEnvironmentId: HOME,
      unsentByThreadKey: {},
      query: "",
    });
    const labels = Object.fromEntries(
      inbox.rows.map((row) => [`${row.bot.environmentId}:${row.bot.title}`, row.hostLabel]),
    );
    expect(labels).toEqual({
      "home:Finance": null,
      "home:Fitness": "Home",
      "work:fitness ": "Studio",
    });
  });

  it("searches names and previews, with the Assistant among the results", () => {
    const search = (query: string) =>
      buildBotInbox({
        environments: [online(HOME, "Home")],
        projects: [assistant, fitness, finance],
        threads: [
          thread({
            environmentId: HOME,
            id: ThreadId.make("fitness-main"),
            projectId: fitness.id,
            latestRun: run("completed", "2026-10-02T00:00:00.000Z"),
          }),
        ],
        assistantEnvironmentId: HOME,
        unsentByThreadKey: {},
        query,
      });
    expect(search(" ASSIST ").hero).toBeNull();
    expect(search(" ASSIST ").rows.map((row) => row.bot.title)).toEqual(["Home assistant"]);
    expect(search("replied").rows.map((row) => row.bot.title)).toEqual(["Fitness"]);
    expect(search("nothing").rows).toEqual([]);
  });

  it("counts a bot's open threads besides its main conversation", () => {
    const fitnessThread = (id: string, input: Partial<EnvironmentThreadShell> = {}) =>
      thread({ environmentId: HOME, id: ThreadId.make(id), projectId: fitness.id, ...input });
    const threads = [
      fitnessThread("fitness-main", { hasPendingUserInput: true }),
      fitnessThread("squats"),
      fitnessThread("meals"),
      fitnessThread("old", { archivedAt: "2026-10-04T00:00:00.000Z" }),
      thread({ environmentId: WORK, id: ThreadId.make("elsewhere"), projectId: fitness.id }),
    ];
    // The main conversation's own request is on screen already; it doesn't tint the badge.
    expect(botSecondaryThreadCount(fitness, threads)).toEqual({ open: 2, needsYou: false });
    expect(
      botSecondaryThreadCount(fitness, [
        ...threads,
        fitnessThread("form", { hasPendingApprovals: true }),
      ]),
    ).toEqual({ open: 3, needsYou: true });
  });
});
