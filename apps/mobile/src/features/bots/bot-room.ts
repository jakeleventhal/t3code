import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { toSortableTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";

export type BotRole = "assistant" | "specialist";

export interface BotRoomBot {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly role: BotRole;
  readonly title: string;
  /** Null until the Assistant is first opened in this environment. */
  readonly project: EnvironmentProject | null;
  readonly mainThread: EnvironmentThreadShell | null;
  /** Topic threads: the bot's other conversations, newest first. */
  readonly topics: ReadonlyArray<EnvironmentThreadShell>;
}

export interface BotRoomEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly assistant: BotRoomBot;
  readonly specialists: ReadonlyArray<BotRoomBot>;
}

export type BotThreadStatus = "needs-you" | "working" | null;

export function botRole(project: Pick<EnvironmentProject, "botRole">): BotRole | null {
  return project.botRole === "assistant" || project.botRole === "specialist"
    ? project.botRole
    : null;
}

/** Every bot, Assistant included, goes by its project's title, which its profile renames. */
export function botName(project: Pick<EnvironmentProject, "title">): string {
  return project.title;
}

/** Scoped keys of every bot project, for keeping bot work out of Code. */
export function botProjectKeys(projects: ReadonlyArray<EnvironmentProject>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const project of projects) {
    if (botRole(project) !== null) keys.add(scopedProjectKey(project.environmentId, project.id));
  }
  return keys;
}

export function isBotThread(
  keys: ReadonlySet<string>,
  thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): boolean {
  return keys.size > 0 && keys.has(scopedProjectKey(thread.environmentId, thread.projectId));
}

export function botThreadStatus(
  thread: Pick<EnvironmentThreadShell, "hasPendingApprovals" | "hasPendingUserInput" | "latestRun">,
): BotThreadStatus {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "needs-you";
  const status = thread.latestRun?.status;
  return status === "preparing" ||
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "waiting"
    ? "working"
    : null;
}

function newestFirst(left: EnvironmentThreadShell, right: EnvironmentThreadShell) {
  return (
    (toSortableTimestamp(right.updatedAt) ?? 0) - (toSortableTimestamp(left.updatedAt) ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function bot(
  environmentId: EnvironmentId,
  role: BotRole,
  project: EnvironmentProject | null,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): BotRoomBot {
  const mainThreadId = project?.botMainThreadId ?? null;
  const own = project === null ? [] : threads.filter((thread) => thread.projectId === project.id);
  return {
    key:
      project === null ? `assistant:${environmentId}` : scopedProjectKey(environmentId, project.id),
    environmentId,
    role,
    // Before it exists, the Assistant has only its role to go by.
    title: project?.title ?? "Assistant",
    project,
    mainThread: own.find((thread) => thread.id === mainThreadId) ?? null,
    topics: own
      .filter((thread) => thread.id !== mainThreadId && thread.archivedAt === null)
      .sort(newestFirst),
  };
}

/**
 * Each environment owns its bots, so every environment section leads with its own Assistant,
 * even before that Assistant exists. Opening it is what creates it.
 */
export function buildBotRoom(input: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}): ReadonlyArray<BotRoomEnvironment> {
  return input.environments.map(({ environmentId, label }) => {
    const projects = input.projects.filter(
      (project) => project.environmentId === environmentId && botRole(project) !== null,
    );
    const threads = input.threads.filter((thread) => thread.environmentId === environmentId);
    const assistant =
      projects
        .filter((project) => project.botRole === "assistant")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null;
    return {
      environmentId,
      label,
      assistant: bot(environmentId, "assistant", assistant, threads),
      specialists: projects
        .filter((project) => project.botRole === "specialist")
        .sort(
          (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
        )
        .map((project) => bot(environmentId, "specialist", project, threads)),
    };
  });
}
