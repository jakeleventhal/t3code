import { environmentAssistants } from "@t3tools/client-runtime/assistant-environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { toSortableTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { threadHasUnseenCompletion } from "../threads/threadListV2";

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
  /** Assistants besides this environment's own, oldest first. Kept searchable so their histories remain accessible. */
  readonly extraAssistants: ReadonlyArray<BotRoomBot>;
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
    const [assistant = null, ...extraAssistants] = environmentAssistants(projects, environmentId);
    return {
      environmentId,
      label,
      assistant: bot(environmentId, "assistant", assistant, threads),
      extraAssistants: extraAssistants.map((project) =>
        bot(environmentId, "assistant", project, threads),
      ),
      specialists: projects
        .filter((project) => project.botRole === "specialist")
        .sort(
          (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
        )
        .map((project) => bot(environmentId, "specialist", project, threads)),
    };
  });
}

export interface BotThreadList {
  /** The bot's ongoing conversation, when it is loaded and not archived. */
  readonly main: EnvironmentThreadShell | null;
  /** The bot's other open threads, newest first. */
  readonly active: ReadonlyArray<EnvironmentThreadShell>;
  /** Archived threads, most recently archived first. The main conversation is never here. */
  readonly archived: ReadonlyArray<EnvironmentThreadShell>;
}

function matchesTitle(thread: EnvironmentThreadShell, query: string): boolean {
  return query.length === 0 || thread.title.toLocaleLowerCase().includes(query);
}

function newestArchivedFirst(left: EnvironmentThreadShell, right: EnvironmentThreadShell) {
  return (
    (toSortableTimestamp(right.archivedAt ?? right.updatedAt) ?? 0) -
      (toSortableTimestamp(left.archivedAt ?? left.updatedAt) ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * One bot's threads for its Threads sheet. `archived` comes from the archive snapshot, which
 * refreshes after the live list, so a thread reopened a moment ago shows only as open.
 */
export function buildBotThreadList(input: {
  readonly project: Pick<EnvironmentProject, "environmentId" | "id" | "botMainThreadId">;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly archived: ReadonlyArray<EnvironmentThreadShell>;
  readonly query: string;
}): BotThreadList {
  const { project } = input;
  const query = input.query.trim().toLocaleLowerCase();
  const mainThreadId = project.botMainThreadId ?? null;
  const owned = (thread: EnvironmentThreadShell) =>
    thread.environmentId === project.environmentId && thread.projectId === project.id;
  const open = input.threads.filter((thread) => owned(thread) && thread.archivedAt === null);
  const openIds = new Set(open.map((thread) => thread.id));
  return {
    main: open.find((thread) => thread.id === mainThreadId) ?? null,
    active: open
      .filter((thread) => thread.id !== mainThreadId && matchesTitle(thread, query))
      .sort(newestFirst),
    archived: input.archived
      .filter(
        (thread) =>
          owned(thread) &&
          thread.archivedAt !== null &&
          thread.id !== mainThreadId &&
          !openIds.has(thread.id) &&
          matchesTitle(thread, query),
      )
      .sort(newestArchivedFirst),
  };
}

export type BotInboxStatus = "needs-you" | "working" | "offline" | null;

export interface BotInboxEntry {
  readonly bot: BotRoomBot;
  readonly connected: boolean;
  readonly status: BotInboxStatus;
  /** The open thread waiting on the user, when the main conversation itself is not. */
  readonly needsThread: EnvironmentThreadShell | null;
  readonly previewThread: EnvironmentThreadShell | null;
  /** What the main conversation last said, or a plain account of where it stands. */
  readonly preview: string | null;
  /** The main conversation's latest message or reply; null before it has any. */
  readonly activityAt: string | null;
  /** The main conversation or one of its threads has an unseen reply. */
  readonly unread: boolean;
  readonly needsAttention: boolean;
  /** Messages this device holds for the main conversation until its host takes them. */
  readonly unsent: number;
  /** Set only where the name alone would not say which bot this is. */
  readonly hostLabel: string | null;
}

export interface BotInbox {
  /** The Assistant, apart from the list. Null while searching, when it is one of the rows. */
  readonly hero: BotInboxEntry | null;
  readonly rows: ReadonlyArray<BotInboxEntry>;
}

function latestTimestamp(values: ReadonlyArray<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const value of values) {
    const ms = toSortableTimestamp(value ?? undefined);
    if (value != null && ms !== null && ms > latestMs) {
      latest = value;
      latestMs = ms;
    }
  }
  return latest;
}

/**
 * Shells carry no message bodies (thread detail owns them), so `latestVisibleMessage` is usually
 * null and the preview falls back to what the shell does know about the last turn.
 */
function mainPreview(bot: BotRoomBot, unread: boolean): string | null {
  const main = bot.mainThread;
  if (main === null) {
    if (bot.project === null) return "Start a conversation";
    return bot.project.botMainThreadId ? "Reopen conversation" : "No messages yet";
  }
  const text = main.source.latestVisibleMessage?.text.replace(/\s+/g, " ").trim();
  if (text) return text;
  const run = main.latestRun;
  if (run === null) return "No messages yet";
  if (botThreadStatus(main) !== null) return null;
  if (unread) return "New reply";
  if (run.status === "completed") return "Replied";
  if (run.status === "failed") return "Last reply failed";
  return "Stopped";
}

function inboxEntry(
  bot: BotRoomBot,
  connected: boolean,
  unsentByThreadKey: Readonly<Record<string, ReadonlyArray<unknown>>>,
): BotInboxEntry {
  const mainThreadId = bot.project?.botMainThreadId ?? null;
  const main = bot.mainThread;
  const mainStatus = main === null ? null : botThreadStatus(main);
  const topicStatuses = bot.topics.map((topic) => ({ topic, status: botThreadStatus(topic) }));
  const needsThread =
    mainStatus === "needs-you"
      ? null
      : (topicStatuses.find((entry) => entry.status === "needs-you")?.topic ?? null);
  const mainUnread = main !== null && threadHasUnseenCompletion(main);
  const unreadThread = bot.topics.find(threadHasUnseenCompletion);
  const unread = mainUnread || unreadThread !== undefined;
  return {
    bot,
    connected,
    // A disconnected host runs nothing this device can see, so nothing there reads as working.
    status: !connected
      ? "offline"
      : mainStatus === "needs-you" || needsThread !== null
        ? "needs-you"
        : mainStatus === "working" || topicStatuses.some((entry) => entry.status === "working")
          ? "working"
          : null,
    needsThread,
    previewThread:
      mainStatus === "needs-you"
        ? main
        : (needsThread ?? (!mainUnread && unreadThread ? unreadThread : main)),
    needsAttention: mainStatus === "needs-you" || needsThread !== null,
    preview:
      mainStatus !== "needs-you" && !mainUnread && unreadThread
        ? `↳ ${unreadThread.title} · New reply`
        : mainPreview(bot, mainUnread),
    activityAt:
      main === null
        ? null
        : latestTimestamp([
            main.source.latestVisibleMessage
              ? DateTime.formatIso(main.source.latestVisibleMessage.updatedAt)
              : null,
            main.latestUserMessageAt,
            main.latestRun?.completedAt,
            main.latestRun?.requestedAt,
          ]),
    unread,
    unsent:
      mainThreadId === null
        ? 0
        : (unsentByThreadKey[scopedThreadKey(bot.environmentId, mainThreadId)]?.length ?? 0),
    hostLabel: null,
  };
}

function nameKey(entry: BotInboxEntry): string {
  return entry.bot.title.trim().toLocaleLowerCase();
}

function newestActivityFirst(left: BotInboxEntry, right: BotInboxEntry) {
  return (
    (toSortableTimestamp(right.activityAt ?? undefined) ?? 0) -
      (toSortableTimestamp(left.activityAt ?? undefined) ?? 0) ||
    left.bot.title.localeCompare(right.bot.title) ||
    left.bot.key.localeCompare(right.bot.key)
  );
}

function matchesInboxQuery(entry: BotInboxEntry, query: string): boolean {
  return (
    entry.bot.title.toLocaleLowerCase().includes(query) ||
    (entry.preview?.toLocaleLowerCase().includes(query) ?? false)
  );
}

/**
 * Every bot on every shown environment in one inbox. There is one Assistant: the one on
 * `assistantEnvironmentId` leads as the hero, even before it exists, since opening it creates it.
 * Earlier Assistant histories remain in its Threads sheet, rather than appearing as other bots.
 */
export function buildBotInbox(input: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly connected: boolean;
  }>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly assistantEnvironmentId: EnvironmentId | null;
  /** This device's outbox, by scoped thread key. */
  readonly unsentByThreadKey: Readonly<Record<string, ReadonlyArray<unknown>>>;
  readonly query: string;
}): BotInbox {
  const room = buildBotRoom(input);
  const connected = new Map(
    input.environments.map((environment) => [environment.environmentId, environment.connected]),
  );
  const labels = new Map(
    input.environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const heroEnvironment =
    room.find((environment) => environment.environmentId === input.assistantEnvironmentId) ??
    room.find((environment) => environment.assistant.project !== null) ??
    null;
  const entry = (bot: BotRoomBot) =>
    inboxEntry(bot, connected.get(bot.environmentId) === true, input.unsentByThreadKey);
  const hero = heroEnvironment === null ? null : entry(heroEnvironment.assistant);
  const others = room.flatMap((environment) => environment.specialists);
  const all = [...(hero === null ? [] : [hero]), ...others.map(entry)];
  const labelled = all.map((candidate) => {
    const sharesName = all.some(
      (other) =>
        other !== candidate &&
        other.bot.environmentId !== candidate.bot.environmentId &&
        nameKey(other) === nameKey(candidate),
    );
    return candidate !== hero && sharesName
      ? { ...candidate, hostLabel: labels.get(candidate.bot.environmentId) ?? null }
      : candidate;
  });
  const query = input.query.trim().toLocaleLowerCase();
  if (query.length > 0) {
    return {
      hero: null,
      rows: labelled.filter((candidate) => matchesInboxQuery(candidate, query)),
    };
  }
  return hero === null
    ? { hero: null, rows: labelled.sort(newestActivityFirst) }
    : {
        hero: labelled[0]!,
        rows: labelled.slice(1).sort(newestActivityFirst),
      };
}

/** A bot's open threads besides its main conversation, for the count on its Threads button. */
export function botSecondaryThreadCount(
  project: Pick<EnvironmentProject, "environmentId" | "id" | "botMainThreadId">,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): { readonly open: number; readonly needsYou: boolean } {
  let open = 0;
  let needsYou = false;
  for (const thread of threads) {
    if (
      thread.environmentId !== project.environmentId ||
      thread.projectId !== project.id ||
      thread.archivedAt !== null ||
      thread.id === project.botMainThreadId
    ) {
      continue;
    }
    open += 1;
    if (botThreadStatus(thread) === "needs-you") needsYou = true;
  }
  return { open, needsYou };
}

export function botThreadsAccessibilityLabel(badge: {
  readonly open: number;
  readonly needsYou: boolean;
}): string {
  if (badge.open === 0) return "Threads";
  const count = `${badge.open} open ${badge.open === 1 ? "thread" : "threads"}`;
  return badge.needsYou ? `Threads, ${count}, one needs you` : `Threads, ${count}`;
}

export function botNotificationBadge(
  projects: ReadonlyArray<EnvironmentProject>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): string | undefined {
  const keys = new Set(
    projects
      .filter((project) => botRole(project) !== null)
      .map((project) => `${project.environmentId}:${project.id}`),
  );
  let unread = 0;
  for (const thread of threads) {
    if (thread.archivedAt !== null || !keys.has(`${thread.environmentId}:${thread.projectId}`))
      continue;
    if (botThreadStatus(thread) === "needs-you") return "!";
    if (threadHasUnseenCompletion(thread)) unread++;
  }
  return unread === 0 ? undefined : unread > 99 ? "99+" : String(unread);
}
