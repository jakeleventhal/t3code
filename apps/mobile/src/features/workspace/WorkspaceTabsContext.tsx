import { CommonActions, type NavigationState } from "@react-navigation/native";
import { resolveSelectedNavigationTab } from "./navigation-tab-order";
import { useNavigationTabOrder, useHiddenNavigationTabs } from "./navigation-tabs";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  initialWorkspaceTabsState,
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

export function WorkspaceTabsProvider(props: {
  readonly stack?: WorkspaceRoomStack;
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
}) {
  const [state, rawDispatch] = useReducer(
    workspaceTabsReducer,
    undefined,
    initialWorkspaceTabsState,
  );
  // Room changes read the latest state before React renders it, so two in one event compose.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: WorkspaceTabsAction) => {
    stateRef.current = workspaceTabsReducer(stateRef.current, action);
    rawDispatch(action);
  }, []);
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  const selected = resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  if (selected && selected !== state.selectedTab) rawDispatch({ type: "select", tab: selected });
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const { stack } = props;
  const switchRoom = useCallback(
    (room: WorkspaceRoom, target?: RoomRoute, tab?: CodeWorkspaceTab) => {
      const current = stateRef.current;
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
    [stack, dispatch],
  );
  const selectRoom = useCallback(
    (room: WorkspaceRoom, target?: RoomRoute) => switchRoom(room, target),
    [switchRoom],
  );
  const selectTab = useCallback(
    (tab: WorkspaceTab) => {
      if (workspaceTabRoom(tab) === stateRef.current.room) dispatch({ type: "select", tab });
      else switchRoom(workspaceTabRoom(tab), undefined, tab === "bots" ? undefined : tab);
    },
    [switchRoom, dispatch],
  );
  const alignRoom = useCallback(
    (alignment: WorkspaceRoomAlignment, rendered?: NavigationState) => {
      const navigationState = rendered ?? stack?.getState();
      if (stateRef.current.room === alignment.room) return;
      if (stack && navigationState) {
        const routes = alignedRoomRoutes(navigationState.routes, alignment.detail);
        stack.dispatch({
          ...CommonActions.reset({ ...navigationState, index: routes.length - 1, routes }),
          target: navigationState.key,
        });
      }
      dispatch({ type: "room", room: alignment.room, leaving: alignment.leaving });
    },
    [stack, dispatch],
  );
  const activeTab = useRef(state.selectedTab);
  // oxlint-disable-next-line t3code/react-effect-budget -- Native tab callbacks must observe the selected tab from the last committed render.
  useLayoutEffect(() => {
    activeTab.current = state.selectedTab;
  }, [state.selectedTab]);
  const isTabActive = useCallback((tab: WorkspaceTab) => activeTab.current === tab, []);
  const scrollOffsets = useRef({ threads: 0, pullRequests: 0, usage: 0, bots: 0, settings: 0 });
  const getScrollOffset = useCallback((tab: WorkspaceSearchTab) => scrollOffsets.current[tab], []);
  const recordScrollOffset = useCallback((tab: WorkspaceSearchTab, offset: number) => {
    scrollOffsets.current[tab] = offset;
  }, []);
  const context = useMemo(
    () => ({
      state,
      dispatch,
      isTabActive,
      bottomClearance: 0,
      settingsOpen: props.settingsOpen ?? false,
      getScrollOffset,
      recordScrollOffset,
      selectRoom,
      selectTab,
      alignRoom,
    }),
    [
      state,
      dispatch,
      isTabActive,
      getScrollOffset,
      recordScrollOffset,
      props.settingsOpen,
      selectRoom,
      selectTab,
      alignRoom,
    ],
  );
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
