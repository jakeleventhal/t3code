import {
  botMentionsUpdateNotice,
  matchBotMentionItems,
  mergeBotMentionFiles,
  type BotMentionItem,
} from "@t3tools/client-runtime/botMentionItems";
import type { BotFile, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { botEnvironment } from "~/state/bots";
import { useProjects, useServerConfigs, useThreadShells } from "~/state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "~/state/environments";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";

// The newest page is fetched when the menu opens and filtered locally as the user types.
const BOT_MENTION_FILES_LIMIT = 64;
// Once typing pauses, the server also searches every File by title, so older ones can be found.
const BOT_MENTION_FILES_SEARCH_DEBOUNCE_MS = 180;
const BOT_MENTION_FILES_QUERY_MAX = 256;
const EMPTY_FILES: ReadonlyArray<BotFile> = [];

/**
 * Whether a bot's server reads project, bot-file, and other machines' thread references. An older
 * one drops the first two undecoded and can't reach the last, so the client keeps them out.
 */
export function useBotServerReadsMentions(environmentId: EnvironmentId): boolean {
  return useServerConfigs().get(environmentId)?.environment.capabilities.botMentions === true;
}

/** The bot chat @ menu: subscribes to shells, projects and Files only while it is open. */
export function useBotMentionItems(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly botProjectId: ProjectId | null;
  readonly activeThreadId: ThreadId | null;
  readonly query: string;
}): {
  readonly items: ReadonlyArray<BotMentionItem>;
  readonly isLoading: boolean;
  /** Set when the bot's server can't read files, projects, bots, or other machines' threads. */
  readonly notice: string | null;
} {
  const [now] = useState(() => Date.now());
  const active = input.enabled && input.botProjectId !== null;
  const shells = useThreadShells(active);
  const projects = useProjects();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const identities = useEnvironmentIdentities();
  const capabilities = useServerConfigs().get(input.environmentId)?.environment.capabilities;
  const readsMentions = capabilities?.botMentions === true;
  const filesSupported = readsMentions && capabilities?.botProfiles === true;
  const filesQuery = active && filesSupported ? input.botProjectId : null;
  const recentFiles = useEnvironmentQuery(
    filesQuery !== null
      ? botEnvironment.files({
          environmentId: input.environmentId,
          input: { projectId: filesQuery, limit: BOT_MENTION_FILES_LIMIT },
        })
      : null,
  );
  const typedFilesQuery =
    filesQuery !== null ? input.query.trim().slice(0, BOT_MENTION_FILES_QUERY_MAX) : "";
  const searchedFilesQuery = useDebouncedValue(
    typedFilesQuery,
    BOT_MENTION_FILES_SEARCH_DEBOUNCE_MS,
  );
  const searchedFiles = useEnvironmentQuery(
    filesQuery !== null && searchedFilesQuery.length > 0
      ? botEnvironment.files({
          environmentId: input.environmentId,
          input: {
            projectId: filesQuery,
            query: searchedFilesQuery,
            limit: BOT_MENTION_FILES_LIMIT,
          },
        })
      : null,
  );
  if (!active || input.botProjectId === null) {
    return { items: [], isLoading: false, notice: null };
  }

  const connected = new Set<EnvironmentId>(connectedEnvironmentIds);
  connected.add(input.environmentId);
  const environments = new Map<EnvironmentId, string>();
  for (const identity of identities) {
    if (connected.has(identity.environmentId)) {
      environments.set(identity.environmentId, identity.label);
    }
  }
  const items = matchBotMentionItems({
    query: input.query,
    now,
    bot: { environmentId: input.environmentId, projectId: input.botProjectId },
    activeThreadId: input.activeThreadId,
    shells,
    projects,
    files: mergeBotMentionFiles(
      recentFiles.data?.items ?? EMPTY_FILES,
      searchedFiles.data?.items ?? EMPTY_FILES,
    ),
    environments,
    serverReadsMentions: readsMentions,
  });
  const searchSettling =
    typedFilesQuery.length > 0 &&
    (typedFilesQuery !== searchedFilesQuery || searchedFiles.isPending);
  return {
    items,
    // Only shown while nothing matches yet, so a pending server search never hides local results.
    isLoading:
      filesSupported && ((recentFiles.isPending && recentFiles.data === null) || searchSettling),
    notice:
      capabilities !== undefined && !readsMentions
        ? botMentionsUpdateNotice(environments.get(input.environmentId) ?? null)
        : null,
  };
}
