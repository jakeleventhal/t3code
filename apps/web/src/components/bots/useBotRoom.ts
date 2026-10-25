import {
  chooseAssistantEnvironment,
  latestBotPreferences,
  selectBotReplicas,
} from "@t3tools/client-runtime/assistant-environment";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useCommittedLocation } from "../../hooks/useCommittedLocation";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import {
  useProject,
  useProjects,
  useQuietThreadShell,
  useServerConfigs,
} from "../../state/entities";
import { useEnvironmentConnectionSummaries } from "../../state/environments";
import {
  BOTS_HOME_PATH,
  isBotProject,
  isSettingsPath,
  resolveRoom,
  type AppRoom,
  type RouteProjectState,
} from "./botRoom.logic";
import { useBotRoomStore } from "./botRoomStore";

const NO_ROUTE_PROJECT: RouteProjectState<EnvironmentProject> = { kind: "none" };
const PENDING_ROUTE_PROJECT: RouteProjectState<EnvironmentProject> = { kind: "pending" };

function useRouteOwner() {
  const target = useThreadRouteTarget();
  const draftSession = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const shell = useQuietThreadShell(target?.kind === "server" ? target.threadRef : null);
  return { target, owner: shell ?? draftSession };
}

function useRouteProjectState(): RouteProjectState<EnvironmentProject> {
  const { target, owner } = useRouteOwner();
  const project = useProject(owner ? scopeProjectRef(owner.environmentId, owner.projectId) : null);
  if (target === null) return NO_ROUTE_PROJECT;
  return project === null ? PENDING_ROUTE_PROJECT : { kind: "project", project };
}

/** The bot project that owns the routed thread or draft, if any. */
export function useRouteBotProject(): EnvironmentProject | null {
  const routeProject = useRouteProjectState();
  return routeProject.kind === "project" && isBotProject(routeProject.project)
    ? routeProject.project
    : null;
}

export function useAppRoom(): AppRoom {
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeProject = useRouteProjectState();
  const previousRoom = useBotRoomStore((state) => state.room);
  return resolveRoom({ pathname, routeProject, previousRoom });
}

/**
 * The environment of the user's one Assistant, which every entry point opens: the Bots list, its
 * shortcut, New bot's default host and Code's corner card. It is the same rule mobile uses. Code's
 * card never follows the thread on screen; that thread reaches the Assistant as its context.
 */
export function useDesignatedAssistantEnvironmentId(): EnvironmentId | null {
  const environments = useEnvironmentConnectionSummaries();
  const configs = useServerConfigs();
  const projects = useProjects();
  return chooseAssistantEnvironment({
    environments: environments.map((environment) => ({
      environmentId: environment.environmentId,
      environmentLabel: environment.environmentLabel,
      isEnabled: environment.isEnabled,
      connectionState: environment.connectionState,
      supportsBots:
        configs.get(environment.environmentId)?.environment.capabilities.botConversations === true,
    })),
    projects,
    preferences: latestBotPreferences(
      [...configs.values()].map((config) => config.settings.botSharedPreferences),
    ),
  });
}

export function BotRoomLocationTracker() {
  const committed = useCommittedLocation();
  const pathname = committed?.pathname ?? null;
  const href = committed?.href ?? null;
  const target = useThreadRouteTarget();
  const routeProject = useRouteProjectState();
  const previousRoom = useBotRoomStore((state) => state.room);
  const room =
    pathname === null ? previousRoom : resolveRoom({ pathname, routeProject, previousRoom });
  const settled = routeProject.kind !== "pending";
  const botEnvironmentId =
    routeProject.kind === "project" && isBotProject(routeProject.project)
      ? routeProject.project.environmentId
      : null;
  useEffect(() => {
    if (pathname === null || href === null || !settled || isSettingsPath(pathname)) return;
    const { recordLocation } = useBotRoomStore.getState();
    if (room === "code") {
      recordLocation({ room: "code", href });
      return;
    }
    recordLocation({
      room: "bots",
      location: pathname === BOTS_HOME_PATH || target === null ? null : { href, target },
      environmentId: botEnvironmentId,
    });
  }, [botEnvironmentId, href, pathname, room, settled, target]);
  return null;
}

export function useBotProjects() {
  const projects = useProjects();
  const environments = useEnvironmentConnectionSummaries();
  const configs = useServerConfigs();
  return selectBotReplicas({
    projects,
    environments: environments.map((entry) => ({ ...entry, supportsBots: true })),
    preferences: latestBotPreferences(
      [...configs.values()].map((config) => config.settings.botSharedPreferences),
    ),
  });
}
