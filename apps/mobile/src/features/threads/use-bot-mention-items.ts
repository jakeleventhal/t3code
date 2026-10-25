import { useAtomValue } from "@effect/atom-react";
import {
  botMentionsUpdateNotice,
  matchBotMentionItems,
  mergeBotMentionFiles,
  type BotMentionItem,
} from "@t3tools/client-runtime/botMentionItems";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentConnectionSummary } from "@t3tools/client-runtime/state/presentation";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { botEnvironment } from "../../state/bots";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentProjects } from "../../state/projects";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { workspaceConnections } from "../../state/workspace";

/** The largest page `bots.files` serves: the newest one is filtered locally as the user types. */
const BOT_MENTION_FILES_LIMIT = 64;
// Once typing pauses, the server also searches every File by title, so older ones can be found.
const BOT_MENTION_FILES_SEARCH_DEBOUNCE_MS = 180;
const BOT_MENTION_FILES_QUERY_MAX = 256;

const EMPTY_PROJECTS_ATOM = Atom.make<ReadonlyArray<EnvironmentProject>>([]).pipe(
  Atom.withLabel("mobile-bot-mentions:no-projects"),
);
const EMPTY_ENVIRONMENTS_ATOM = Atom.make<ReadonlyArray<EnvironmentConnectionSummary>>([]).pipe(
  Atom.withLabel("mobile-bot-mentions:no-environments"),
);

/** The bot reads other machines through a connected client, so only connected ones count. */
export function botMentionEnvironments(
  environments: ReadonlyArray<
    Pick<EnvironmentConnectionSummary, "environmentId" | "environmentLabel" | "connectionState">
  >,
  botEnvironmentId: EnvironmentId,
): ReadonlyMap<EnvironmentId, string> {
  const readable = new Map<EnvironmentId, string>();
  for (const environment of environments) {
    if (
      environment.environmentId === botEnvironmentId ||
      environment.connectionState === "connected"
    ) {
      readable.set(environment.environmentId, environment.environmentLabel);
    }
  }
  return readable;
}

/**
 * What a bot chat's @ menu offers. Everything subscribes only while the menu is open. The bot's
 * newest Files load once per opening and typing filters them; a paused query also asks the server.
 */
export function useBotMentionItems(input: {
  readonly bot: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId } | null;
  readonly query: string | null;
  readonly now: number;
  readonly activeThreadId: ThreadId | null;
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
}): {
  readonly items: ReadonlyArray<BotMentionItem>;
  readonly isLoading: boolean;
  /** Set when the bot's server can't read files, projects, bots, or other machines' threads. */
  readonly notice: string | null;
} {
  const { bot } = input;
  const open = bot !== null && input.query !== null;
  const projects = useAtomValue(open ? environmentProjects.projectsAtom : EMPTY_PROJECTS_ATOM);
  const environments = useAtomValue(
    open ? workspaceConnections.environmentsAtom : EMPTY_ENVIRONMENTS_ATOM,
  );
  const capabilities = useEnvironmentServerConfig(open ? bot.environmentId : null)?.environment
    .capabilities;
  const readsMentions = capabilities?.botMentions === true;
  const filesSupported = open && readsMentions && capabilities?.botProfiles === true;
  const recentFiles = useEnvironmentQuery(
    filesSupported
      ? botEnvironment.files({
          environmentId: bot.environmentId,
          input: { projectId: bot.projectId, limit: BOT_MENTION_FILES_LIMIT },
        })
      : null,
  );
  const typedFilesQuery = filesSupported
    ? (input.query ?? "").trim().slice(0, BOT_MENTION_FILES_QUERY_MAX)
    : "";
  const searchedFilesQuery = useDebouncedValue(
    typedFilesQuery,
    BOT_MENTION_FILES_SEARCH_DEBOUNCE_MS,
  );
  const searchedFiles = useEnvironmentQuery(
    filesSupported && searchedFilesQuery.length > 0
      ? botEnvironment.files({
          environmentId: bot.environmentId,
          input: {
            projectId: bot.projectId,
            query: searchedFilesQuery,
            limit: BOT_MENTION_FILES_LIMIT,
          },
        })
      : null,
  );
  if (!open) return { items: [], isLoading: false, notice: null };

  const readable = botMentionEnvironments(environments, bot.environmentId);
  const searchSettling =
    typedFilesQuery.length > 0 &&
    (typedFilesQuery !== searchedFilesQuery || searchedFiles.isPending);
  return {
    items: matchBotMentionItems({
      query: input.query ?? "",
      now: input.now,
      bot,
      activeThreadId: input.activeThreadId,
      shells: input.shells,
      projects,
      files: mergeBotMentionFiles(recentFiles.data?.items ?? [], searchedFiles.data?.items ?? []),
      environments: readable,
      serverReadsMentions: readsMentions,
    }),
    // Only shown while nothing matches yet, so a pending server search never hides local results.
    isLoading: recentFiles.isPending || searchSettling,
    notice:
      capabilities !== undefined && !readsMentions
        ? botMentionsUpdateNotice(readable.get(bot.environmentId) ?? null)
        : null,
  };
}
