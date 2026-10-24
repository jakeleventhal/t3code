import {
  WORKSPACE_TAB_LABELS,
  NAVIGATION_TAB_ICONS,
  useEnabledNavigationTabs,
} from "./navigation-tabs";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions, type NativeSyntheticEvent } from "react-native";
import { Tabs, type TabSelectedEvent, type TabSelectionRejectedEvent } from "react-native-screens";

import {
  WorkspaceRoomContext,
  WorkspaceTabsContext,
  useWorkspaceTabs,
} from "./WorkspaceTabsContext";
import {
  NATIVE_WORKSPACE_TAB_SLOTS,
  workspaceTabForNativeSlot,
  workspaceRoomTab,
  workspaceTabRoom,
  workspaceUsesColumns,
  type WorkspaceRoom,
  type WorkspaceTab,
} from "./workspace-tabs-state";
import {
  NativeWorkspaceTabActivityContext,
  WorkspaceSlotOptionsContext,
} from "../../native/v5-workspace-context";
import { useCompactWorkspaceTabs, useSystemWorkspaceTabBar } from "./useSystemWorkspaceTabBar";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { useDeviceType } from "../../native/native-layout-metrics";
import { WorkspaceSidebarTabs } from "./WorkspaceSidebarTabs";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";

const PULL_REQUEST_ICON = require("../../../assets/icons/pull-request.png");

/**
 * Retain each native controller tree; removing its root can leave RNS's stack empty. Every tab
 * renders the one workspace stack, so a tab left for the other room keeps only its root page:
 * that room's pages are parked, and must not stay mounted beside the live copy in another tab.
 */
function RetainedWorkspaceTab(props: {
  readonly tab: WorkspaceTab;
  readonly active: boolean;
  /** The room the selected tab shows this frame. */
  readonly room: WorkspaceRoom;
  readonly children: ReactNode;
}) {
  const workspace = useWorkspaceTabs()!;
  // Whether this slot is the visible one, read by cleanups after the switch has committed.
  const activeRef = useRef(props.active);
  useLayoutEffect(() => {
    activeRef.current = props.active;
  }, [props.active]);
  const isActive = useCallback(() => activeRef.current, []);
  const activity = useMemo(
    () => ({
      active: props.active,
      isActive,
    }),
    [props.active, isActive],
  );
  const [optionsByRoute, setOptionsByRoute] = useState<ReadonlyMap<string, object>>(new Map());
  // Stable, so writers and the cleanups that depend on them don't re-run on every write.
  const setRouteOptions = useCallback(
    (routeKey: string, options: object) =>
      setOptionsByRoute((current) =>
        new Map(current).set(routeKey, { ...current.get(routeKey), ...options }),
      ),
    [],
  );
  const slotOptions = useMemo(
    () => ({ byRoute: optionsByRoute, set: setRouteOptions }),
    [optionsByRoute, setRouteOptions],
  );
  const [content, setContent] = useState(
    props.active ? { workspace, children: props.children, room: props.room, live: true } : null,
  );
  if (props.active) {
    if (
      !content?.live ||
      content.workspace !== workspace ||
      content.children !== props.children ||
      content.room !== props.room
    )
      setContent({ workspace, children: props.children, room: props.room, live: true });
  } else if (content?.live && content.room !== props.room) {
    setContent({ ...content, children: props.children, live: false });
  }
  return content ? (
    <NativeWorkspaceTabActivityContext value={activity}>
      <WorkspaceSlotOptionsContext value={slotOptions}>
        <WorkspaceRoomContext value={content.room}>
          <WorkspaceTabsContext value={content.workspace}>{content.children}</WorkspaceTabsContext>
        </WorkspaceRoomContext>
      </WorkspaceSlotOptionsContext>
    </NativeWorkspaceTabActivityContext>
  ) : null;
}

// A hook result is immutable to the React Compiler, so handing the section to `renderTab` cannot
// invalidate the memoized tab request derived from it.
function useWorkspaceRoomTab(room: WorkspaceRoom) {
  return workspaceRoomTab(useWorkspaceTabs()!.state, room);
}

export function WorkspaceNativeTabs(props: {
  /** The room the stack belongs to, already aligned for this frame. */
  readonly room: WorkspaceRoom;
  /** Renders the stack for a section; a section that is not selected gets its root page only. */
  readonly renderTab: (tab: WorkspaceTab, active: boolean) => ReactNode;
  readonly hidden: boolean;
}) {
  const workspace = useWorkspaceTabs()!;
  const order = useEnabledNavigationTabs();
  const primaryTabs = order.slice(0, 4);
  const overflow = order[4];
  const selectTab = useSelectWorkspaceTab();
  const [provenance, setProvenance] = useState(0);
  const systemTabBar = useSystemWorkspaceTabBar();
  const deviceType = useDeviceType();
  const compactTabs = useCompactWorkspaceTabs();
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const compactSidebarTabs = deviceType === "phone" || !layout.usesSplitView;
  const { width } = useWindowDimensions();
  const { colors } = useControlTheme();
  // An aligned page can lead the room state by a frame; show the section of the room it is in.
  const selectedTab = useWorkspaceRoomTab(props.room);
  const selectedSlot = workspace.settingsOpen ? -1 : primaryTabs.indexOf(selectedTab);
  const request = useMemo(
    () => ({
      selectedScreenKey:
        selectedSlot === -1 ? "settings" : NATIVE_WORKSPACE_TAB_SLOTS[selectedSlot]!,
      baseProvenance: provenance,
    }),
    [selectedSlot, provenance],
  );
  return (
    <View style={{ flex: 1 }}>
      <Tabs.Host
        navStateRequest={request}
        tabBarHidden={props.hidden || !systemTabBar}
        ios={{
          tabBarControllerMode: "tabBar",
          tabBarMinimizeBehavior: "never",
          tabBarTintColor: colors["--color-primary"],
        }}
        onTabSelectionRejected={({
          nativeEvent,
        }: NativeSyntheticEvent<TabSelectionRejectedEvent>) =>
          setProvenance(nativeEvent.provenance)
        }
        onTabSelected={({ nativeEvent }: NativeSyntheticEvent<TabSelectedEvent>) => {
          setProvenance(nativeEvent.provenance);
          if (nativeEvent.actionOrigin === "programmatic-js") return;
          const tab = workspaceTabForNativeSlot(primaryTabs, nativeEvent.selectedScreenKey);
          if (tab) selectTab(tab);
        }}
      >
        {NATIVE_WORKSPACE_TAB_SLOTS.map((slot, index) => {
          const settings = slot === "settings";
          // `order` is the hook's immutable list; an element of the sliced copy passed to `renderTab`
          // would make the compiler treat `primaryTabs` (and the slot request) as mutable.
          const tab = settings ? (overflow ?? selectedTab) : order[index];
          if (!tab) return null;
          const active = settings ? selectedSlot === -1 : selectedSlot === index;
          return (
            <Tabs.Screen
              // Stable slot controllers keep UIKit's stacks attached when a section moves into Settings.
              key={slot}
              screenKey={slot}
              title=""
              tabBarItemAccessibilityLabel={settings ? "Settings" : WORKSPACE_TAB_LABELS[tab]}
              ios={{
                icon: settings
                  ? { type: "sfSymbol", name: "gearshape" }
                  : tab === "pullRequests"
                    ? { type: "templateSource", templateSource: PULL_REQUEST_ICON }
                    : { type: "sfSymbol", name: NAVIGATION_TAB_ICONS[tab] },
                selectedIcon:
                  !settings && tab === "threads"
                    ? { type: "sfSymbol", name: "text.bubble.fill" }
                    : !settings && tab === "bots"
                      ? { type: "sfSymbol", name: "square.grid.2x2.fill" }
                      : undefined,
                overrideScrollViewContentInsetAdjustmentBehavior: false,
              }}
            >
              <RetainedWorkspaceTab tab={tab} active={active} room={props.room}>
                {props.renderTab(active ? selectedTab : tab, active)}
              </RetainedWorkspaceTab>
            </Tabs.Screen>
          );
        })}
      </Tabs.Host>
      {(deviceType === "pad" ||
        compactTabs ||
        (layout.primarySidebarOverlaysContent &&
          !workspaceUsesColumns(selectedTab, workspace.settingsOpen))) &&
      !props.hidden ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: layout.listPaneWidth ?? width,
            height: 128,
          }}
        >
          <WorkspaceSidebarTabs
            compact={compactSidebarTabs}
            reserveComposeSpace={compactSidebarTabs}
            onNewTask={
              compactSidebarTabs && !workspace.settingsOpen && selectedTab === "threads"
                ? startNewTask
                : undefined
            }
          />
        </View>
      ) : null}
    </View>
  );
}
