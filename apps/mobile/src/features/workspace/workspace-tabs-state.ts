import type { NavigationState } from "@react-navigation/native";
import {
  NAVIGATION_TAB_ORDER,
  navigationCustomizationAvailable,
  resolveNavigationTabOrder,
  type NavigationTab,
} from "./navigation-tab-order";

export function resolveWorkspaceTabOrder(saved: readonly unknown[] | undefined) {
  return navigationCustomizationAvailable()
    ? resolveNavigationTabOrder(saved)
    : NAVIGATION_TAB_ORDER;
}

export type WorkspaceTab = NavigationTab;
/** Bots holds bot conversations; every other section belongs to Code. */
export type WorkspaceRoom = "code" | "bots";
export type CodeWorkspaceTab = Exclude<WorkspaceTab, "bots">;
export type WorkspaceRoute = NavigationState["routes"][number];

export function workspaceTabRoom(tab: WorkspaceTab): WorkspaceRoom {
  return tab === "bots" ? "bots" : "code";
}

/** The section a room shows, for tabs that keep rendering a room the state has left. */
export function workspaceRoomTab(
  state: Pick<WorkspaceTabsState, "selectedTab" | "codeTab">,
  room: WorkspaceRoom,
): WorkspaceTab {
  if (room === "bots") return "bots";
  return state.selectedTab === "bots" ? state.codeTab : state.selectedTab;
}

/** Lists with their own search: the searchable tabs and the Settings list. */
export type WorkspaceSearchTab = WorkspaceTab | "settings";
export type WorkspaceSearchMode = "resting" | "active" | "expanded";

/** Settings, Chats and pull requests pair a list with a detail column; Usage is one page. */
export function workspaceUsesColumns(tab: WorkspaceTab, settingsOpen = false) {
  return settingsOpen || tab === "threads" || tab === "pullRequests" || tab === "bots";
}

export interface WorkspaceTabState {
  readonly query: string;
  readonly searchMode: WorkspaceSearchMode;
  readonly scrollOffset: number;
  readonly searchEntryOffset: number;
}

export interface WorkspaceTabsState {
  readonly room: WorkspaceRoom;
  /** The pages each room was left on, while the other room owns the navigation stack. */
  readonly parkedRoutes: Readonly<Record<WorkspaceRoom, readonly WorkspaceRoute[]>>;
  readonly selectedTab: WorkspaceTab;
  /** The section Code returns to from Bots. */
  readonly codeTab: CodeWorkspaceTab;
  readonly selectionRevision: number;
  readonly tabs: Readonly<Record<WorkspaceSearchTab, WorkspaceTabState>>;
}

function emptyTab(): WorkspaceTabState {
  return { query: "", searchMode: "resting", scrollOffset: 0, searchEntryOffset: 0 };
}

export function initialWorkspaceTabsState(): WorkspaceTabsState {
  return {
    room: "code",
    parkedRoutes: { code: [], bots: [] },
    selectedTab: "threads",
    codeTab: "threads",
    selectionRevision: 0,
    tabs: {
      threads: emptyTab(),
      pullRequests: emptyTab(),
      usage: emptyTab(),
      settings: emptyTab(),
      bots: emptyTab(),
    },
  };
}

export type WorkspaceTabsAction =
  | {
      readonly type: "room";
      readonly room: WorkspaceRoom;
      /** The pages the current room is leaving, to bring back when it is entered again. */
      readonly leaving?: readonly WorkspaceRoute[];
      /** The Code section to enter; Code's own last section otherwise. */
      readonly tab?: CodeWorkspaceTab;
    }
  | { readonly type: "select"; readonly tab: WorkspaceTab }
  | { readonly type: "search"; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "query"; readonly query: string; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "expand"; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "cancel"; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "scroll"; readonly tab: WorkspaceSearchTab; readonly offset: number };

export function workspaceTabsReducer(
  state: WorkspaceTabsState,
  action: WorkspaceTabsAction,
): WorkspaceTabsState {
  if (action.type === "room") {
    if (action.room === state.room) return state;
    const selectedTab = action.room === "bots" ? "bots" : (action.tab ?? state.codeTab);
    return {
      ...state,
      room: action.room,
      parkedRoutes: {
        ...state.parkedRoutes,
        [state.room]: action.leaving ?? [],
        [action.room]: [],
      },
      selectedTab,
      codeTab: selectedTab === "bots" ? state.codeTab : selectedTab,
      selectionRevision: state.selectionRevision + 1,
    };
  }
  if (action.type === "select") {
    if (action.tab === state.selectedTab) return state;
    // Crossing rooms here has no stack to park; callers that hold one use selectTab.
    if (workspaceTabRoom(action.tab) !== state.room)
      return workspaceTabsReducer(state, {
        type: "room",
        room: workspaceTabRoom(action.tab),
        ...(action.tab === "bots" ? {} : { tab: action.tab }),
      });
    return {
      ...state,
      selectedTab: action.tab,
      codeTab: action.tab === "bots" ? state.codeTab : action.tab,
      selectionRevision: state.selectionRevision + 1,
    };
  }
  const tab = action.tab ?? state.selectedTab;
  if (tab !== "threads" && tab !== "pullRequests" && tab !== "settings") return state;
  const current = state.tabs[tab];
  let next: WorkspaceTabState;
  switch (action.type) {
    case "search":
      next = {
        ...current,
        searchMode: "active",
        searchEntryOffset:
          current.searchMode === "resting" ? current.scrollOffset : current.searchEntryOffset,
      };
      break;
    case "query":
      next = { ...current, query: action.query };
      break;
    case "expand":
      if (current.searchMode === "resting") return state;
      next = { ...current, searchMode: "expanded" };
      break;
    case "cancel":
      next = {
        ...current,
        query: "",
        searchMode: "resting",
        scrollOffset: current.searchEntryOffset,
      };
      break;
    case "scroll":
      if (current.scrollOffset === action.offset) return state;
      next = { ...current, scrollOffset: action.offset };
      break;
  }
  return { ...state, tabs: { ...state.tabs, [tab]: next } };
}

export const WORKSPACE_TOOLBAR = { height: 48, expandedGap: 10, edge: 16, gap: 8 };
export const WORKSPACE_DOCK = { height: 48, tabsWidth: 176, gap: 12, bottomGap: 6 };

export function workspaceDockBottomClearance(input: {
  readonly bottomInset: number;
  readonly keyboardHeight: number;
}) {
  return 64 + Math.max(input.bottomInset, input.keyboardHeight) + 16;
}

export function workspaceSearchBottomClearance(input: {
  readonly bottomInset: number;
  readonly bottomBarInset?: number;
  readonly keyboardHeight: number;
}) {
  const bottom = input.bottomBarInset ?? Math.max(input.bottomInset, 12);
  // AboveKeyboard lifts the field to an 8-point gap above the keyboard.
  return (
    Math.max(bottom, input.keyboardHeight > 0 ? input.keyboardHeight + 8 : 0) +
    WORKSPACE_TOOLBAR.height +
    16
  );
}

export function workspaceToolbarHeight(mode: WorkspaceSearchMode): number {
  return mode === "expanded"
    ? WORKSPACE_TOOLBAR.height * 2 + WORKSPACE_TOOLBAR.expandedGap
    : WORKSPACE_TOOLBAR.height;
}

export const NATIVE_WORKSPACE_TAB_SLOTS = [
  "first",
  "second",
  "third",
  "fourth",
  "settings",
] as const;

export function workspaceTabForNativeSlot(order: readonly WorkspaceTab[], slot: string) {
  if (slot === "settings") return "settings";
  const index = NATIVE_WORKSPACE_TAB_SLOTS.findIndex((candidate) => candidate === slot);
  return order[index] ?? null;
}
