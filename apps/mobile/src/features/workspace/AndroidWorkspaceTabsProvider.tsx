import { useNavigation, type NavigationState } from "@react-navigation/native";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import { androidWorkspaceSettingsOpen } from "./android-workspace-tabs";
import { useRoomAlignment } from "../bots/use-room-alignment";
import { WorkspaceTabsProvider, type WorkspaceRoomStack } from "./WorkspaceTabsContext";
import { workspaceDetailRoutes } from "./workspace-rooms";

interface AndroidWorkspaceRoot {
  /**
   * The rail's `useNavigation()` dispatches to the focused navigator, which may be nested Settings.
   * Target the root stack's key (and read `rootNavigationRef`'s state) so a tab press resets the root.
   */
  readonly key: string;
  /** Settings is derived from navigation rather than kept in the tab reducer. */
  readonly settingsOpen: boolean;
  readonly settingsRoute: NavigationState["routes"][number] | undefined;
  readonly settingsPage: string | null;
}

const AndroidWorkspaceRootContext = createContext<AndroidWorkspaceRoot | null>(null);

export function useAndroidWorkspaceRoot() {
  return use(AndroidWorkspaceRootContext);
}

/** Hands a page opened in the other room's stack to that room. */
function AndroidRoomAlignment(props: { readonly state: NavigationState }) {
  const detail = useMemo(() => workspaceDetailRoutes(props.state.routes), [props.state.routes]);
  useRoomAlignment(detail, props.state);
  return null;
}

/** Android keeps one tab controller above the root navigator and split sidebar. */
export function AndroidWorkspaceTabsProvider(props: {
  readonly state: NavigationState;
  readonly children: ReactNode;
}) {
  const key = props.state.key;
  const stateRef = useRef(props.state);
  useLayoutEffect(() => { stateRef.current = props.state; }, [props.state]);
  const getState = useCallback(() => stateRef.current, []);
  const settingsOpen = Platform.OS === "android" && androidWorkspaceSettingsOpen(props.state);
  const settingsIndex = props.state.routes.findIndex((route) => route.name === "Settings");
  const settingsRoute = settingsIndex < 0 ? undefined : props.state.routes[settingsIndex];
  const settingsPage =
    settingsIndex < 0 ? null : (props.state.routes[settingsIndex + 1]?.name ?? null);
  const root = { key, settingsOpen, settingsRoute, settingsPage };
  // The layout's navigation is the container; room resets carry the root key as their target.
  const navigation = useNavigation();
  const stack = useMemo<WorkspaceRoomStack>(
    () => ({ getState, dispatch: (action) => navigation.dispatch(action) }),
    [getState, navigation],
  );
  return Platform.OS === "android" ? (
    <WorkspaceTabsProvider stack={stack}>
      <AndroidRoomAlignment state={props.state} />
      <AndroidWorkspaceRootContext value={root}>{props.children}</AndroidWorkspaceRootContext>
    </WorkspaceTabsProvider>
  ) : (
    props.children
  );
}
