import {
  chooseAssistantEnvironment,
  environmentAssistant,
} from "@t3tools/client-runtime/assistant-environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, MessageId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { useProjects, useServerConfigs } from "../../state/entities";
import { uuidv4 } from "../../lib/uuid";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { botHostCandidates } from "./bot-turn-settings";

/** Workspace environments plus saved connections: the environments this device knows. */
export function useKnownBotEnvironments() {
  const workspaceEnvironments = useWorkspaceEnvironments();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const serverConfigs = useServerConfigs();
  // Only servers that advertise bots can get the first Assistant; an older server that already
  // has one keeps it and says why it can't open.
  return useMemo(() => {
    const known = new Set(workspaceEnvironments.map((environment) => environment.environmentId));
    const savedOnly = Object.values(savedConnectionsById)
      .filter((connection) => !known.has(connection.environmentId))
      .map((connection) => ({
        environmentId: connection.environmentId,
        environmentLabel: connection.environmentLabel,
        isEnabled: true,
        connectionState: "available",
      }));
    return [...workspaceEnvironments, ...savedOnly].map((environment) => ({
      environmentId: environment.environmentId,
      environmentLabel: environment.environmentLabel,
      isEnabled: environment.isEnabled,
      connectionState: environment.connectionState,
      supportsBots:
        serverConfigs.get(environment.environmentId)?.environment.capabilities.botConversations ===
        true,
    }));
  }, [workspaceEnvironments, savedConnectionsById, serverConfigs]);
}

export function useBotHostCandidates() {
  const environments = useKnownBotEnvironments();
  return useMemo(() => botHostCandidates(environments), [environments]);
}

/**
 * The user's one Assistant, the same on every entry point: the Bots hero, the orb and the quick
 * sheet. Neither the Code list's filter nor the thread on screen picks it; what's on screen
 * travels with each quick message as context.
 */
export function useAssistantEnvironmentId(): EnvironmentId | null {
  const environments = useKnownBotEnvironments();
  const projects = useProjects();
  return useMemo(
    () => chooseAssistantEnvironment({ environments, projects }),
    [environments, projects],
  );
}

export function useAssistantProject(
  environmentId: EnvironmentId | null,
): EnvironmentProject | null {
  const projects = useProjects();
  return useMemo(() => environmentAssistant(projects, environmentId), [projects, environmentId]);
}

/**
 * Opens a conversation full size in Bots. Code's pages are parked, so returning to Code shows
 * the thread or pull request that was open, and any sheet over it closes. `reveal` opens it at
 * one message or turn item instead of the end.
 */
export function useShowConversationInBots() {
  const selectRoom = useWorkspaceTabs()?.selectRoom;
  return useCallback(
    (target: {
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly reveal?: {
        readonly messageId: MessageId | null;
        readonly turnItemId: TurnItemId | null;
      };
    }) => {
      const reveal = target.reveal;
      selectRoom?.("bots", {
        name: "Thread",
        params: {
          environmentId: String(target.environmentId),
          threadId: String(target.threadId),
          ...(reveal && (reveal.messageId !== null || reveal.turnItemId !== null)
            ? {
                revealKey: uuidv4(),
                ...(reveal.messageId === null ? {} : { revealMessageId: String(reveal.messageId) }),
                ...(reveal.turnItemId === null
                  ? {}
                  : { revealTurnItemId: String(reveal.turnItemId) }),
              }
            : {}),
        },
      });
    },
    [selectRoom],
  );
}
