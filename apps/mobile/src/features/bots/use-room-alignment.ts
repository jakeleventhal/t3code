import { useAtomValue } from "@effect/atom-react";
import type { NavigationState } from "@react-navigation/native";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback, useLayoutEffect, useMemo } from "react";

import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  isPullRequestRoute,
  planRoomAlignment,
  routeThreadRef,
} from "../workspace/workspace-rooms";
import type { WorkspaceRoom, WorkspaceRoute } from "../workspace/workspace-tabs-state";
import { botRole } from "./bot-room";

const NO_THREAD = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("mobile-bots:no-aligned-thread"),
);
const NO_PROJECT = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("mobile-bots:no-aligned-project"),
);
const selectProjectId = (thread: EnvironmentThreadShell | null) => thread?.projectId ?? null;
const selectRoom = (project: EnvironmentProject | null): WorkspaceRoom | null =>
  project === null ? null : botRole(project) === null ? "code" : "bots";

/**
 * Which room the stack's pages belong to. Only the top thread is looked up, through selectors,
 * so streaming turns never re-render the navigator.
 */
function useRouteOwner(detail: readonly WorkspaceRoute[]) {
  const thread = routeThreadRef(detail.findLast((route) => routeThreadRef(route) !== null));
  const environmentId = thread === null ? null : EnvironmentId.make(thread.environmentId);
  const threadId = thread === null ? null : ThreadId.make(thread.threadId);
  const projectId = useAtomValue(
    environmentId === null || threadId === null
      ? NO_THREAD
      : environmentThreadShells.quietThreadShellAtom({ environmentId, threadId }),
    selectProjectId,
  );
  const threadRoom = useAtomValue(
    environmentId === null || projectId === null
      ? NO_PROJECT
      : environmentProjects.projectAtom({ environmentId, projectId }),
    selectRoom,
  );
  return useCallback(
    (route: WorkspaceRoute): WorkspaceRoom | null => {
      if (isPullRequestRoute(route)) return "code";
      const ref = routeThreadRef(route);
      return ref !== null && ref.environmentId === environmentId && ref.threadId === threadId
        ? threadRoom
        : null;
    },
    [environmentId, threadId, threadRoom],
  );
}

/**
 * A bot chat opened from search, a notification, or a link moves to Bots, and a Code page
 * opened from Bots moves to Code. The returned alignment is what to render this frame; the
 * stack and room catch up before paint, keeping the same route keys so nothing remounts.
 */
export function useRoomAlignment(detail: readonly WorkspaceRoute[], rendered?: NavigationState) {
  const workspace = useWorkspaceTabs();
  const room = workspace?.state.room ?? "code";
  const ownerOf = useRouteOwner(detail);
  const alignment = useMemo(
    () => planRoomAlignment({ detail, room, ownerOf }),
    [detail, room, ownerOf],
  );
  const alignRoom = workspace?.alignRoom;
  useLayoutEffect(() => {
    if (alignment !== null) alignRoom?.(alignment, rendered);
  }, [alignment, alignRoom, rendered]);
  return alignment;
}
