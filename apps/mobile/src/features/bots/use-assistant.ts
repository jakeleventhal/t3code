import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, MessageId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { useProjects, useServerConfigs } from "../../state/entities";
import { uuidv4 } from "../../lib/uuid";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useHomeListOptions } from "../home/home-list-options";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { chooseAssistantEnvironment } from "./assistant-environment";

export function useAssistantEnvironmentId(): EnvironmentId | null {
  const workspaceEnvironments = useWorkspaceEnvironments();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const serverConfigs = useServerConfigs();
  // The same environments the Code list can be filtered to. Only servers that advertise bots
  // can become the fallback; a filtered older one still owns the Assistant and says why.
  const environments = useMemo(() => {
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
  const projects = useProjects();
  const environmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  // Only reads the Code list's filter; resolving it here never changes the list's selection.
  const selectedEnvironmentId = useHomeListOptions(environmentIds).options.selectedEnvironmentId;
  return useMemo(
    () => chooseAssistantEnvironment({ environments, selectedEnvironmentId, projects }),
    [environments, selectedEnvironmentId, projects],
  );
}

export function useAssistantProject(
  environmentId: EnvironmentId | null,
): EnvironmentProject | null {
  const projects = useProjects();
  return useMemo(
    () =>
      projects
        .filter(
          (project) => project.environmentId === environmentId && project.botRole === "assistant",
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null,
    [projects, environmentId],
  );
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
