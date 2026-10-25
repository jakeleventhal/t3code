import type {
  BotFile,
  BotFileContextRecord,
  ComposerContextRecord,
  EnvironmentId,
  ProjectContextRecord,
  ProjectId,
  ReferenceContextRecord,
  ThreadContextRecord,
  ThreadId,
} from "@t3tools/contracts";
import {
  collectComposerContextReferences,
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import {
  foldSearchQuery,
  rankSearchGroups,
  scoreSearchTerms,
  scoreThreadSearch,
  threadRecentUse,
  type SearchTermsMatch,
  type ThreadSearchMatch,
} from "@t3tools/shared/paletteSearch";

import type { EnvironmentProject, EnvironmentThreadShell } from "./state/models.ts";
import { threadSearchSubject, type ThreadSearchShell } from "./state/threadSearch.ts";

export type BotMentionGroup = "files" | "conversations" | "projects" | "bots";

export const BOT_MENTION_GROUP_LABELS: Readonly<Record<BotMentionGroup, string>> = {
  files: "Files",
  conversations: "Conversations",
  projects: "Projects",
  bots: "Bots",
};

export interface BotMentionItem {
  readonly id: string;
  readonly type: "reference";
  readonly group: BotMentionGroup;
  readonly reference: ReferenceContextRecord;
  readonly label: string;
  readonly description: string;
}

export type BotMentionThreadCandidate = ThreadSearchShell &
  Pick<EnvironmentThreadShell, "projectId" | "archivedAt" | "lineage">;

export type BotMentionProjectCandidate = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "botRole" | "botMainThreadId" | "updatedAt" | "isScratch"
>;

// The empty-query list is a short sampler per group; typing searches everything.
const SUGGESTION_LIMITS: Readonly<Record<BotMentionGroup, number>> = {
  files: 3,
  conversations: 4,
  projects: 3,
  bots: 3,
};
const SEARCH_LIMITS: Readonly<Record<BotMentionGroup, number>> = {
  files: 4,
  conversations: 6,
  projects: 3,
  bots: 3,
};
const GROUP_ORDER: ReadonlyArray<BotMentionGroup> = ["files", "conversations", "projects", "bots"];

export function threadReferenceRecord(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
}): ThreadContextRecord {
  const label = sanitizeComposerContextLabel(input.title, "thread");
  return {
    version: 1,
    kind: "thread",
    // Same id the Code composer gives a thread, so one thread is one reference.
    contextId: toKindScopedComposerContextId("thread", input.threadId),
    label,
    environmentId: input.environmentId,
    threadId: input.threadId,
    title: label,
  };
}

export function projectReferenceRecord(project: BotMentionProjectCandidate): ProjectContextRecord {
  const label = sanitizeComposerContextLabel(project.title, "project");
  return {
    version: 1,
    kind: "project",
    contextId: toKindScopedComposerContextId("project", `${project.environmentId}:${project.id}`),
    label,
    environmentId: project.environmentId,
    projectId: project.id,
    title: label,
    botRole: project.botRole ?? null,
    ...(project.botRole != null && project.botMainThreadId
      ? { mainThreadId: project.botMainThreadId }
      : {}),
  };
}

export function botFileReferenceRecord(
  bot: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  file: BotFile,
): BotFileContextRecord {
  const label = sanitizeComposerContextLabel(file.title, "bot-file");
  const stored =
    file.kind === "attachment"
      ? { attachmentId: file.attachment.id, mimeType: file.attachment.mimeType }
      : { attachmentId: file.htmlRender.attachmentId, mimeType: "text/html" };
  return {
    version: 1,
    kind: "bot-file",
    contextId: toKindScopedComposerContextId("bot-file", file.id),
    label,
    environmentId: bot.environmentId,
    projectId: bot.projectId,
    fileId: file.id,
    fileKind: file.kind,
    title: label,
    ...stored,
    sourceThreadId: file.sourceThreadId,
    ...(file.sourceMessageId ? { sourceMessageId: file.sourceMessageId } : {}),
    ...(file.sourceTurnItemId ? { sourceTurnItemId: file.sourceTurnItemId } : {}),
  };
}

function botFileKindLabel(file: BotFile): string {
  if (file.kind === "html") return "Published page";
  return file.attachment.type === "image" ? "Image" : "File";
}

/**
 * Files for the menu: the newest page, plus whatever the server found for the typed query, which
 * reaches Files older than that page. Each appears once.
 */
export function mergeBotMentionFiles(
  recent: ReadonlyArray<BotFile>,
  searched: ReadonlyArray<BotFile>,
): ReadonlyArray<BotFile> {
  if (searched.length === 0) return recent;
  const seen = new Set(recent.map((file) => file.id));
  const extra = searched.filter((file) => !seen.has(file.id));
  return extra.length === 0 ? recent : [...recent, ...extra];
}

/**
 * References in `text` that a bot's server can't read. A server without `botMentions` reads only
 * threads on its own machine: it drops project and bot-file records undecoded and has no route to
 * another machine's threads, so sending them would silently lose them.
 */
export function referencesBotServerCannotRead(input: {
  readonly text: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
  readonly environmentId: EnvironmentId;
  readonly serverReadsMentions: boolean;
}): ReferenceContextRecord[] {
  if (input.serverReadsMentions) return [];
  const referenced = new Set(
    collectComposerContextReferences(input.text).map((occurrence) => occurrence.contextId),
  );
  return input.records.filter(
    (record): record is ReferenceContextRecord =>
      referenced.has(record.contextId) && needsBotMentions(record, input.environmentId),
  );
}

function needsBotMentions(record: ComposerContextRecord, environmentId: EnvironmentId): boolean {
  if ("payload" in record) return false;
  if (record.kind === "thread") return record.environmentId !== environmentId;
  return record.kind === "project" || record.kind === "bot-file";
}

/** What to tell the user when the bot's server predates mentions beyond its own threads. */
export function botMentionsUpdateNotice(hostLabel: string | null): string {
  return `Update T3 Code on ${hostLabel ?? "this bot's machine"} to mention files, projects, bots, and threads on other machines.`;
}

const projectKey = (environmentId: EnvironmentId, projectId: ProjectId) =>
  `${environmentId}:${projectId}`;

/**
 * What a bot chat's @ menu offers: this bot's Files, conversations (its own threads, other bots'
 * and Code threads, archived ones only when searched), Code projects, and other bots, across the
 * environments the bot can read. Never raw workspace files: picking curates what the bot is
 * pointed at, it does not sandbox what it can open.
 */
export function matchBotMentionItems(input: {
  readonly query: string;
  /** Recency is measured against this time. */
  readonly now: number;
  readonly bot: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly activeThreadId: ThreadId | null;
  readonly shells: ReadonlyArray<BotMentionThreadCandidate>;
  readonly projects: ReadonlyArray<BotMentionProjectCandidate>;
  /** This bot's Files, newest first, as far as they have been loaded. */
  readonly files: ReadonlyArray<BotFile>;
  /**
   * Environments the bot can read, by label: its own and the connected ones. Anything elsewhere
   * is left out rather than offered as something the bot cannot open.
   */
  readonly environments: ReadonlyMap<EnvironmentId, string>;
  /**
   * False for a server without `botMentions`: it reads only threads on its own machine, so the
   * menu offers only those rather than chips the server would drop.
   */
  readonly serverReadsMentions?: boolean;
}): BotMentionItem[] {
  const { bot } = input;
  const readsMentions = input.serverReadsMentions !== false;
  const readable = (environmentId: EnvironmentId) =>
    environmentId === bot.environmentId || (readsMentions && input.environments.has(environmentId));
  // Names repeat across machines; say where an item lives whenever it is not the bot's own.
  const hostLabel = (environmentId: EnvironmentId) =>
    environmentId === bot.environmentId ? null : (input.environments.get(environmentId) ?? null);
  const withHost = (description: string, environmentId: EnvironmentId) => {
    const host = hostLabel(environmentId);
    return host ? `${description} · ${host}` : description;
  };

  const projectsByKey = new Map<string, BotMentionProjectCandidate>();
  for (const project of input.projects) {
    if (readable(project.environmentId)) {
      projectsByKey.set(projectKey(project.environmentId, project.id), project);
    }
  }
  const threadTitles = new Map<string, string>();
  const projectActivity = new Map<string, number>();
  const threadActivity = new Map<string, number>();
  const shells = input.shells.filter((shell) => {
    if (!readable(shell.environmentId)) return false;
    if (shell.environmentId === bot.environmentId) threadTitles.set(shell.id, shell.title);
    if (shell.lineage.relationshipToParent === "subagent") return false;
    const activity = threadRecentUse(threadSearchSubject(shell, null));
    threadActivity.set(`${shell.environmentId}:${shell.id}`, activity);
    if (shell.archivedAt === null) {
      const key = projectKey(shell.environmentId, shell.projectId);
      projectActivity.set(key, Math.max(projectActivity.get(key) ?? 0, activity));
    }
    return shell.id !== input.activeThreadId || shell.environmentId !== bot.environmentId;
  });

  const ownerOf = (shell: BotMentionThreadCandidate) =>
    projectsByKey.get(projectKey(shell.environmentId, shell.projectId)) ?? null;
  const isOtherBotMain = (shell: BotMentionThreadCandidate) => {
    const owner = ownerOf(shell);
    return (
      owner !== null &&
      owner.botRole != null &&
      owner.botMainThreadId === shell.id &&
      projectKey(owner.environmentId, owner.id) !== projectKey(bot.environmentId, bot.projectId)
    );
  };
  const conversationItem = (shell: BotMentionThreadCandidate): BotMentionItem => {
    const owner = ownerOf(shell);
    const ownerTitle = owner === null || owner.isScratch ? "Code" : owner.title;
    const description = shell.archivedAt === null ? ownerTitle : `Archived · ${ownerTitle}`;
    const reference = threadReferenceRecord({
      environmentId: shell.environmentId,
      threadId: shell.id,
      title: shell.title,
    });
    return {
      id: `reference:thread:${shell.environmentId}:${shell.id}`,
      type: "reference",
      group: "conversations",
      reference,
      label: shell.title,
      description: withHost(description, shell.environmentId),
    };
  };

  const otherProjects = [...projectsByKey.values()].filter(
    (project) =>
      projectKey(project.environmentId, project.id) !==
      projectKey(bot.environmentId, bot.projectId),
  );
  const codeProjects = readsMentions
    ? otherProjects.filter((project) => project.botRole == null && project.isScratch !== true)
    : [];
  const otherBots = readsMentions ? otherProjects.filter((project) => project.botRole != null) : [];
  const files = readsMentions ? input.files : [];
  const projectItem = (project: BotMentionProjectCandidate): BotMentionItem => {
    const isBot = project.botRole != null;
    return {
      id: `reference:project:${project.environmentId}:${project.id}`,
      type: "reference",
      group: isBot ? "bots" : "projects",
      reference: projectReferenceRecord(project),
      label: project.title,
      description: (() => {
        const description =
          project.botRole === "assistant" ? "Assistant" : isBot ? "Bot" : "Project";
        const ambiguous = [...projectsByKey.values()].some(
          (other) =>
            projectKey(other.environmentId, other.id) !==
              projectKey(project.environmentId, project.id) && other.title === project.title,
        );
        return ambiguous ? withHost(description, project.environmentId) : description;
      })(),
    };
  };
  const fileItem = (file: BotFile): BotMentionItem => {
    const source = threadTitles.get(file.sourceThreadId);
    return {
      id: `reference:bot-file:${file.id}`,
      type: "reference",
      group: "files",
      reference: botFileReferenceRecord(bot, file),
      label: file.title,
      description: source ? `${botFileKindLabel(file)} · ${source}` : botFileKindLabel(file),
    };
  };

  const query = foldSearchQuery(input.query);
  if (query.length === 0) {
    const projectRecency = (project: BotMentionProjectCandidate) =>
      (project.botRole != null && project.botMainThreadId
        ? threadActivity.get(`${project.environmentId}:${project.botMainThreadId}`)
        : projectActivity.get(projectKey(project.environmentId, project.id))) ??
      Date.parse(project.updatedAt);
    const byRecency = (left: BotMentionProjectCandidate, right: BotMentionProjectCandidate) =>
      projectRecency(right) - projectRecency(left);
    const isOwnThread = (shell: BotMentionThreadCandidate) =>
      shell.environmentId === bot.environmentId && shell.projectId === bot.projectId;
    const conversations = shells
      .filter((shell) => shell.archivedAt === null && !isOtherBotMain(shell))
      // This bot's own threads lead; the rest follow by when the user last used them.
      .sort(
        (left, right) =>
          Number(isOwnThread(right)) - Number(isOwnThread(left)) ||
          (threadActivity.get(`${right.environmentId}:${right.id}`) ?? 0) -
            (threadActivity.get(`${left.environmentId}:${left.id}`) ?? 0),
      );
    const groups: Record<BotMentionGroup, BotMentionItem[]> = {
      files: files.slice(0, SUGGESTION_LIMITS.files).map(fileItem),
      conversations: conversations.slice(0, SUGGESTION_LIMITS.conversations).map(conversationItem),
      projects: [...codeProjects]
        .sort(byRecency)
        .slice(0, SUGGESTION_LIMITS.projects)
        .map(projectItem),
      bots: [...otherBots].sort(byRecency).slice(0, SUGGESTION_LIMITS.bots).map(projectItem),
    };
    return GROUP_ORDER.flatMap((group) => groups[group]);
  }

  type Candidate =
    | { readonly kind: "file"; readonly file: BotFile }
    | { readonly kind: "thread"; readonly shell: BotMentionThreadCandidate }
    | { readonly kind: "project"; readonly project: BotMentionProjectCandidate };
  const labelEnvironments = input.environments.size > 1;
  const ranked = rankSearchGroups(
    [
      { group: "files", items: files.map((file): Candidate => ({ kind: "file", file })) },
      {
        group: "conversations",
        items: shells.map((shell): Candidate => ({ kind: "thread", shell })),
      },
      {
        group: "projects",
        items: codeProjects.map((project): Candidate => ({ kind: "project", project })),
      },
      {
        group: "bots",
        items: otherBots.map((project): Candidate => ({ kind: "project", project })),
      },
    ] satisfies ReadonlyArray<{ group: BotMentionGroup; items: ReadonlyArray<Candidate> }>,
    (candidate, options): SearchTermsMatch | ThreadSearchMatch | null => {
      if (candidate.kind === "file") {
        return scoreSearchTerms(
          query,
          [candidate.file.title, botFileKindLabel(candidate.file)],
          options,
        );
      }
      if (candidate.kind === "project") {
        const host = hostLabel(candidate.project.environmentId);
        return scoreSearchTerms(
          query,
          host ? [candidate.project.title, host] : [candidate.project.title],
          options,
        );
      }
      const owner = ownerOf(candidate.shell);
      return scoreThreadSearch(
        query,
        threadSearchSubject(
          candidate.shell,
          owner?.title ?? null,
          labelEnvironments ? input.environments.get(candidate.shell.environmentId) : null,
        ),
        input.now,
        { ...options, picks: false },
      );
    },
  );
  return ranked.flatMap(({ group, ranked: matches }) =>
    matches
      .slice(0, SEARCH_LIMITS[group])
      .map(({ item: candidate }) =>
        candidate.kind === "file"
          ? fileItem(candidate.file)
          : candidate.kind === "thread"
            ? conversationItem(candidate.shell)
            : projectItem(candidate.project),
      ),
  );
}
