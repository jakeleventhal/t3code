import type { EnvironmentId, ProjectBotRole, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export type AppRoom = "code" | "bots";

export const BOTS_HOME_PATH = "/bots";

interface BotRoleCarrier {
  readonly botRole?: ProjectBotRole | null | undefined;
}

export function isBotProject(project: BotRoleCarrier | null | undefined): boolean {
  return project?.botRole != null;
}

/** Returns the input itself when it holds no bots, so memoized consumers keep their cache. */
export function withoutBotProjects<T extends BotRoleCarrier>(
  projects: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return projects.some(isBotProject)
    ? projects.filter((project) => !isBotProject(project))
    : projects;
}

export function botProjectKeys(
  projects: ReadonlyArray<BotRoleCarrier & { environmentId: string; id: string }>,
): ReadonlySet<string> | null {
  const keys = projects
    .filter(isBotProject)
    .map((project) => `${project.environmentId}:${project.id}`);
  return keys.length === 0 ? null : new Set(keys);
}

export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export type RouteProjectState<P> =
  | { readonly kind: "none" }
  | { readonly kind: "pending" }
  | { readonly kind: "project"; readonly project: P };

/**
 * A thread route whose shell or project has not loaded yet keeps the room it was in, so a deep
 * link or reconnect never flashes the wrong sidebar or records a bot thread as the Code location.
 */
export function resolveRoom(input: {
  readonly pathname: string;
  readonly routeProject: RouteProjectState<BotRoleCarrier>;
  readonly previousRoom: AppRoom;
}): AppRoom {
  if (input.pathname === BOTS_HOME_PATH) return "bots";
  if (input.routeProject.kind === "pending") return input.previousRoom;
  if (input.routeProject.kind === "project" && isBotProject(input.routeProject.project)) {
    return "bots";
  }
  return "code";
}

export function partitionEnvironmentBots<
  P extends BotRoleCarrier & { environmentId: EnvironmentId; title: string },
>(
  projects: ReadonlyArray<P>,
  environmentId: EnvironmentId | null,
): { readonly assistant: P | null; readonly specialists: ReadonlyArray<P> } {
  let assistant: P | null = null;
  const specialists: P[] = [];
  for (const project of projects) {
    if (project.environmentId !== environmentId || !isBotProject(project)) continue;
    if (project.botRole === "assistant") assistant ??= project;
    else specialists.push(project);
  }
  specialists.sort((left, right) => left.title.localeCompare(right.title));
  return { assistant, specialists };
}

/** The main conversation leads; topics follow, most recently active first. */
export function orderBotConversations<
  T extends {
    readonly id: ThreadId;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  },
>(
  threads: ReadonlyArray<T>,
  mainThreadId: ThreadId | null | undefined,
): {
  readonly main: T | null;
  readonly topics: ReadonlyArray<T>;
} {
  let main: T | null = null;
  const topics: T[] = [];
  for (const thread of threads) {
    if (thread.id === mainThreadId) main = thread;
    else if (thread.archivedAt === null) topics.push(thread);
  }
  topics.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { main, topics };
}

function firstConnected(
  candidates: ReadonlyArray<EnvironmentId | null>,
  connectedEnvironmentIds: ReadonlyArray<EnvironmentId>,
): EnvironmentId | null {
  for (const candidate of candidates) {
    if (candidate !== null && connectedEnvironmentIds.includes(candidate)) return candidate;
  }
  return connectedEnvironmentIds[0] ?? null;
}

/** The environment the Bots room shows: the routed bot, else where Bots was last left. */
export function resolveBotsEnvironmentId(input: {
  readonly routeBotEnvironmentId: EnvironmentId | null;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly routeEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}): EnvironmentId | null {
  if (input.routeBotEnvironmentId !== null) return input.routeBotEnvironmentId;
  return firstConnected(
    [input.selectedEnvironmentId, input.routeEnvironmentId, input.primaryEnvironmentId],
    input.connectedEnvironmentIds,
  );
}

/**
 * The environment Code's Assistant answers on: the work on screen, so reviewing a thread on one
 * environment never sends its questions to the Assistant last opened on another. That holds while
 * the environment is offline too; quietly moving to another one would put a private conversation
 * somewhere the user didn't pick.
 */
export function resolveAssistantEnvironmentId(input: {
  readonly routeEnvironmentId: EnvironmentId | null;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}): EnvironmentId | null {
  if (input.routeEnvironmentId !== null) return input.routeEnvironmentId;
  return firstConnected(
    [input.selectedEnvironmentId, input.primaryEnvironmentId],
    input.connectedEnvironmentIds,
  );
}

interface BotEntryThread {
  readonly deletedAt: string | null;
  readonly archivedAt: string | null;
}

export type BotsRoomEntry =
  | { readonly kind: "saved" }
  | { readonly kind: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "home" };

/**
 * Where entering Bots lands, and whether the saved spot is gone for good. A thread missing from
 * a shell that is still loading or reconnecting may yet appear, so that case lands on Bots home
 * and keeps the saved spot. Entering never writes: an archived Assistant main waits for an
 * explicit open.
 */
export function resolveBotsRoomEntry(input: {
  readonly saved:
    | { readonly kind: "thread"; readonly thread: BotEntryThread | null }
    | { readonly kind: "draft"; readonly exists: boolean }
    | null;
  readonly shellAuthoritative: boolean;
  readonly assistantMain: {
    readonly threadRef: ScopedThreadRef;
    readonly thread: BotEntryThread | null;
  } | null;
}): { readonly entry: BotsRoomEntry; readonly pruneSaved: boolean } {
  const { saved } = input;
  let pruneSaved = false;
  if (saved !== null) {
    if (saved.kind === "draft") {
      if (saved.exists) return { entry: { kind: "saved" }, pruneSaved: false };
      pruneSaved = true;
    } else if (saved.thread !== null && saved.thread.deletedAt === null) {
      return { entry: { kind: "saved" }, pruneSaved: false };
    } else if (input.shellAuthoritative) {
      pruneSaved = true;
    } else {
      return { entry: { kind: "home" }, pruneSaved: false };
    }
  }
  const main = input.assistantMain;
  if (main?.thread != null && main.thread.deletedAt === null && main.thread.archivedAt === null) {
    return { entry: { kind: "thread", threadRef: main.threadRef }, pruneSaved };
  }
  return { entry: { kind: "home" }, pruneSaved };
}

export function botInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2);
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}
