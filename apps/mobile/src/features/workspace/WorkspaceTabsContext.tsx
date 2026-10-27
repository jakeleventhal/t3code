import { CommonActions, type NavigationState } from "@react-navigation/native";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, use, useState, useCallback, type ReactNode } from "react";

import { mobilePreferencesAtom } from "../../state/preferences";
import {
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  resolveSelectedNavigationTab,
} from "./navigation-tab-order";
import {
  initialWorkspaceTabsState,
  resolveWorkspaceTabOrder,
  workspaceTabRoom,
  workspaceTabsReducer,
  type WorkspaceSearchTab,
  type CodeWorkspaceTab,
  type WorkspaceRoom,
  type WorkspaceRoute,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";
import { alignedRoomRoutes, planRoomSwitch, type RoomRoute } from "./workspace-rooms";

/** The root stack both rooms share. */
export interface WorkspaceRoomStack {
  readonly getState: () => NavigationState | undefined;
  readonly dispatch: (
    action: ReturnType<typeof CommonActions.reset> & { readonly target: string },
  ) => void;
}

export interface WorkspaceRoomAlignment {
  readonly room: WorkspaceRoom;
  readonly detail: readonly WorkspaceRoute[];
  readonly leaving: readonly WorkspaceRoute[];
}

export const WorkspaceTabsContext = createContext<{
  readonly state: WorkspaceTabsState;
  readonly dispatch: (action: WorkspaceTabsAction) => void;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly settingsOpen: boolean;
  readonly getScrollOffset: (tab: WorkspaceSearchTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => void;
  /**
   * Switches rooms, parking the current room's pages and bringing back the other's, or opening
   * `target` there instead.
   */
  readonly selectRoom: (room: WorkspaceRoom, target?: RoomRoute) => void;
  /** Selects a section, switching rooms when it belongs to the other one. */
  readonly selectTab: (tab: WorkspaceTab) => void;
  /**
   * Hands a page opened in the wrong room to the room that owns it. `rendered` is the state the
   * alignment was planned from, for callers whose stack reads lag a render behind.
   */
  readonly alignRoom: (alignment: WorkspaceRoomAlignment, rendered?: NavigationState) => void;
} | null>(null);

/**
 * Set when each room owns its own native tab, so a retained tab keeps rendering its room while
 * the other one is selected. Null where one root shows whichever room is selected.
 */
export const WorkspaceRoomContext = createContext<WorkspaceRoom | null>(null);

export function useWorkspaceTabs() {
  return use(WorkspaceTabsContext);
}

type MobilePreferencesResult = Atom.Type<typeof mobilePreferencesAtom>;

/** Moves the selection off a tab the user has hidden or that no longer exists. */
function resolveWorkspaceTabsSelection(
  state: WorkspaceTabsState,
  preferences: MobilePreferencesResult,
): WorkspaceTabsState {
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const order = resolveWorkspaceTabOrder(saved?.navigationTabOrder);
  const hidden = navigationCustomizationAvailable()
    ? resolveHiddenNavigationTabs(saved?.hiddenNavigationTabs)
    : [];
  const selected = resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  return selected && selected !== state.selectedTab
    ? workspaceTabsReducer(state, { type: "select", tab: selected })
    : state;
}

// One model per provider. Handlers on frozen screens keep stale closures, so
// they read the current selection from the registry at call time.
function createWorkspaceTabsModel() {
  const stored = Atom.make(initialWorkspaceTabsState());
  const scrollOffsets: Record<WorkspaceSearchTab, number> = {
    threads: 0,
    pullRequests: 0,
    usage: 0,
    bots: 0,
    settings: 0,
  };
  return {
    stored,
    resolved: Atom.make((get) =>
      resolveWorkspaceTabsSelection(get(stored), get(mobilePreferencesAtom)),
    ),
    getScrollOffset: (tab: WorkspaceSearchTab) => scrollOffsets[tab],
    recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => {
      scrollOffsets[tab] = offset;
    },
  };
}

export function WorkspaceTabsProvider(props: {
  readonly stack?: WorkspaceRoomStack;
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
}) {
  const registry = use(RegistryContext);
  const [model] = useState(createWorkspaceTabsModel);
  const state = useAtomValue(model.resolved);
  const dispatch = useCallback(
    (action: WorkspaceTabsAction) =>
      registry.set(model.stored, workspaceTabsReducer(registry.get(model.resolved), action)),
    [registry, model],
  );
  const { stack } = props;
  const switchRoom = useCallback(
    (room: WorkspaceRoom, target?: RoomRoute, tab?: CodeWorkspaceTab) => {
      const current = registry.get(model.resolved);
      const navigationState = stack?.getState();
      const action = { type: "room", room, ...(tab ? { tab } : {}) } as const;
      if (!stack || !navigationState) {
        dispatch(action);
        return;
      }
      // Code reopens its pages only in the section they were left in, as switching sections
      // within Code closes them.
      const parked =
        room === "code" && tab !== undefined && tab !== current.codeTab
          ? []
          : current.parkedRoutes[room];
      const plan = planRoomSwitch({
        routes: navigationState.routes,
        from: current.room,
        to: room,
        parked,
        target,
      });
      if (plan === null) return;
      stack.dispatch({
        ...CommonActions.reset({
          ...navigationState,
          index: plan.routes.length - 1,
          routes: plan.routes,
        }),
        target: navigationState.key,
      });
      dispatch({ ...action, leaving: plan.leaving });
    },
    [stack, dispatch, registry, model],
  );
  const selectRoom = useCallback(
    (room: WorkspaceRoom, target?: RoomRoute) => switchRoom(room, target),
    [switchRoom],
  );
  const selectTab = useCallback(
    (tab: WorkspaceTab) => {
      if (workspaceTabRoom(tab) === registry.get(model.resolved).room)
        dispatch({ type: "select", tab });
      else switchRoom(workspaceTabRoom(tab), undefined, tab === "bots" ? undefined : tab);
    },
    [switchRoom, dispatch, registry, model],
  );
  const alignRoom = useCallback(
    (alignment: WorkspaceRoomAlignment, rendered?: NavigationState) => {
      const navigationState = rendered ?? stack?.getState();
      if (registry.get(model.resolved).room === alignment.room) return;
      if (stack && navigationState) {
        const routes = alignedRoomRoutes(navigationState.routes, alignment.detail);
        stack.dispatch({
          ...CommonActions.reset({ ...navigationState, index: routes.length - 1, routes }),
          target: navigationState.key,
        });
      }
      dispatch({ type: "room", room: alignment.room, leaving: alignment.leaving });
    },
    [stack, dispatch, registry, model],
  );
  const context = {
    state,
    dispatch,
    selectRoom,
    selectTab,
    alignRoom,
    isTabActive: (tab: WorkspaceTab) => registry.get(model.resolved).selectedTab === tab,
    bottomClearance: 0,
    settingsOpen: props.settingsOpen ?? false,
    getScrollOffset: model.getScrollOffset,
    recordScrollOffset: model.recordScrollOffset,
  };
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
