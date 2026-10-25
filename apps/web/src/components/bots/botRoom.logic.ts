import {
  environmentAssistant,
  environmentAssistants,
} from "@t3tools/client-runtime/assistant-environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
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
  P extends BotRoleCarrier & {
    environmentId: EnvironmentId;
    id: string;
    title: string;
    createdAt: string;
  },
>(
  projects: ReadonlyArray<P>,
  environmentId: EnvironmentId | null,
): {
  readonly assistant: P | null;
  /** Assistants besides the environment's own, oldest first; kept reachable, never merged. */
  readonly extraAssistants: ReadonlyArray<P>;
  readonly specialists: ReadonlyArray<P>;
} {
  const specialists = projects.filter(
    (project) => project.environmentId === environmentId && project.botRole === "specialist",
  );
  specialists.sort((left, right) => left.title.localeCompare(right.title));
  const [assistant = null, ...extraAssistants] = environmentAssistants(projects, environmentId);
  return { assistant, extraAssistants, specialists };
}

export interface BotsCollectionEntry<P> {
  readonly environmentId: EnvironmentId;
  /** Null only for an Assistant that opening will create. */
  readonly project: P | null;
  /** The host, shown only to tell same-named bots apart and on Assistants besides the main one. */
  readonly hostLabel: string | null;
  readonly offline: boolean;
}

export interface BotsCollection<P> {
  readonly assistant: BotsCollectionEntry<P> | null;
  readonly specialists: ReadonlyArray<BotsCollectionEntry<P>>;
  /** Assistants other than the designated one. They stay reachable; nothing merges or hides them. */
  readonly otherAssistants: ReadonlyArray<BotsCollectionEntry<P>>;
}

function botNameKey(title: string): string {
  return title.trim().toLocaleLowerCase();
}

/**
 * Every bot on every environment this client has loaded, in one list. Offline environments keep
 * their cached bots, marked offline rather than dropped or moved. The designated environment's
 * Assistant leads, even before it exists; every other Assistant is listed with its host.
 */
export function buildBotsCollection<
  P extends BotRoleCarrier & {
    environmentId: EnvironmentId;
    id: string;
    title: string;
    createdAt: string;
  },
>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly connected: boolean;
  }>;
  readonly assistantEnvironmentId: EnvironmentId | null;
  readonly query: string;
}): BotsCollection<P> {
  const environments = new Map(
    input.environments.map((environment) => [environment.environmentId, environment]),
  );
  const label = (environmentId: EnvironmentId) =>
    environments.get(environmentId)?.label ?? environmentId;
  const entry = (environmentId: EnvironmentId, project: P | null): BotsCollectionEntry<P> => ({
    environmentId,
    project,
    hostLabel: null,
    offline: environments.get(environmentId)?.connected !== true,
  });
  const bots = input.projects.filter(
    (project) => isBotProject(project) && environments.has(project.environmentId),
  );
  const assistantEnvironmentId =
    input.assistantEnvironmentId !== null && environments.has(input.assistantEnvironmentId)
      ? input.assistantEnvironmentId
      : null;
  const mainAssistant = environmentAssistant(bots, assistantEnvironmentId);
  const assistant =
    assistantEnvironmentId === null ? null : entry(assistantEnvironmentId, mainAssistant);
  const specialists = bots
    .filter((project) => project.botRole === "specialist")
    .map((project) => entry(project.environmentId, project));
  const otherAssistants = bots
    .filter((project) => project.botRole === "assistant" && project !== mainAssistant)
    .sort(
      (left, right) =>
        label(left.environmentId).localeCompare(label(right.environmentId)) ||
        left.createdAt.localeCompare(right.createdAt),
    )
    .map((project) => ({
      ...entry(project.environmentId, project),
      hostLabel: label(project.environmentId),
    }));

  const titleOf = (candidate: BotsCollectionEntry<P>) => candidate.project?.title ?? "Assistant";
  const named = [...(assistant === null ? [] : [assistant]), ...specialists];
  const disambiguate = (candidate: BotsCollectionEntry<P>): BotsCollectionEntry<P> =>
    named.some(
      (other) =>
        other.environmentId !== candidate.environmentId &&
        botNameKey(titleOf(other)) === botNameKey(titleOf(candidate)),
    )
      ? { ...candidate, hostLabel: label(candidate.environmentId) }
      : candidate;
  const query = botNameKey(input.query);
  const matches = (candidate: BotsCollectionEntry<P>) =>
    query.length === 0 || titleOf(candidate).toLocaleLowerCase().includes(query);

  const shownAssistant = assistant === null ? null : disambiguate(assistant);
  return {
    assistant: shownAssistant !== null && matches(shownAssistant) ? shownAssistant : null,
    specialists: specialists
      .map(disambiguate)
      .filter(matches)
      .sort(
        (left, right) =>
          titleOf(left).trim().localeCompare(titleOf(right).trim()) ||
          (left.hostLabel ?? "").localeCompare(right.hostLabel ?? "") ||
          left.environmentId.localeCompare(right.environmentId),
      ),
    otherAssistants: otherAssistants.filter(matches),
  };
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

export function matchesBotThreadQuery(title: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0 || title.toLowerCase().includes(normalized);
}

/** A bot's archived threads, most recently archived first. Its main conversation never archives. */
export function archivedBotThreads<
  T extends {
    readonly id: ThreadId;
    readonly projectId: string;
    readonly archivedAt: string | null;
  },
>(threads: ReadonlyArray<T>, projectId: string, mainThreadId: ThreadId | null | undefined): T[] {
  return threads
    .filter(
      (thread) =>
        thread.projectId === projectId && thread.archivedAt !== null && thread.id !== mainThreadId,
    )
    .sort((left, right) => right.archivedAt!.localeCompare(left.archivedAt!));
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

export type BotThreadRenameProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed"; readonly error: unknown };

/**
 * Resolves true only once the title is saved or nothing changed, so an inline editor stays open
 * with the user's text after a rejection, a lost permission or a failed save.
 */
export async function commitBotThreadRename(input: {
  readonly title: string;
  readonly currentTitle: string;
  readonly canOperate: () => boolean;
  readonly save: (title: string) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly report: (problem: BotThreadRenameProblem) => void;
}): Promise<boolean> {
  const title = input.title.trim();
  if (title.length === 0) {
    input.report({ kind: "empty" });
    return false;
  }
  if (title === input.currentTitle) return true;
  if (!input.canOperate()) {
    input.report({ kind: "forbidden" });
    return false;
  }
  const result = await input.save(title);
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    input.report({ kind: "failed", error: squashAtomCommandFailure(result) });
  }
  return false;
}
