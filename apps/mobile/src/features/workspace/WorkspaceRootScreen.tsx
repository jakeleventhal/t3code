import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { WORKSPACE_TAB_LABELS, useEnabledNavigationTabs } from "./navigation-tabs";
import { WorkspaceExtraTab } from "./WorkspaceExtraTab";
import { SettingsRouteScreen } from "../settings/SettingsRouteScreen";
import { WorkspaceSectionToolbar } from "./WorkspaceSectionToolbar";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { use, useCallback, useMemo } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { isDuoDevice } from "../../lib/device-type";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useWorkspaceSurface } from "./useWorkspaceSurface";
import {
  useDeviceType,
  useDuoBottomBarInset,
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { dispatchHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceConnectionTitle } from "../home/WorkspaceConnectionTitle";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import {
  WorkspaceRoomContext,
  WorkspaceTabsContext,
  WorkspaceTabsProvider,
  useWorkspaceTabs,
} from "./WorkspaceTabsContext";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import {
  WORKSPACE_DOCK,
  workspaceRoomTab,
  workspaceSearchBottomClearance,
  workspaceDockBottomClearance,
  workspaceToolbarHeight,
} from "./workspace-tabs-state";
import { WorkspaceSidebarTabs } from "./WorkspaceSidebarTabs";
import {
  useCompactWorkspaceTabs,
  useSidebarWorkspaceTabs,
  useSystemWorkspaceTabBar,
} from "./useSystemWorkspaceTabBar";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { ActiveBotCallBar } from "../bots/ActiveBotCall";
import {
  AssistantOrb,
  PROMINENT_ASSISTANT_ORB_SIZE,
  useOpenAssistantQuick,
} from "../bots/AssistantOrb";
import { BotsScreen } from "../bots/BotsScreen";
import { BotsToolbar } from "../bots/BotsToolbar";
import { useBotCallSummary } from "../bots/use-bot-call";

const TAB_TITLES = WORKSPACE_TAB_LABELS;

// Clears the list behind the Assistant button, which floats above the tab bar.
const ASSISTANT_ORB_CLEARANCE = PROMINENT_ASSISTANT_ORB_SIZE + 12;
// The call bar shares the orb's row, so the list clears whichever is taller.
const CALL_BAR_CLEARANCE = 66;

function WorkspaceRootTitle(props: {
  readonly maxWidth: number;
  readonly onOpenEnvironments: () => void;
}) {
  const { state, settingsOpen } = useWorkspaceTabs()!;
  const room = use(WorkspaceRoomContext) ?? state.room;
  const enabled = useEnabledNavigationTabs();
  const tabTitle = settingsOpen
    ? "Settings"
    : enabled.length
      ? TAB_TITLES[state.selectedTab]
      : "Navigation";
  return (
    <View style={{ width: props.maxWidth, minHeight: 32, justifyContent: "center" }}>
      <WorkspaceConnectionTitle
        brand={<CompactBrandTitle accessibilityLabel={`T3 Code, ${tabTitle}`} />}
        maxWidth={props.maxWidth}
        onPress={props.onOpenEnvironments}
      />
    </View>
  );
}

function WorkspaceRootContent() {
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const { width: windowWidth } = useWindowDimensions();
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const primaryColumn = use(NativePrimaryColumnContext);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const nativeMetrics = useNativeLayoutMetrics();
  const deviceType = useDeviceType();
  const surface = useWorkspaceSurface();
  const systemTabBar = useSystemWorkspaceTabBar();
  const compactTabs = useCompactWorkspaceTabs();
  const enabled = useEnabledNavigationTabs();
  const sidebarTabs = useSidebarWorkspaceTabs();
  const sidebarPicker = sidebarTabs === "picker" || (deviceType === "pad" && layout.usesSplitView);
  const sidebarNavigation =
    primaryColumn !== null &&
    (layout.usesSplitView ||
      deviceType === "pad" ||
      (nativeMetrics !== null && nativeMetrics.verticalBarEdge !== "none"));
  const width = columnMetrics?.width ?? windowWidth;
  const insets = useSafeAreaInsets();
  const bottomBarInset = useDuoBottomBarInset();
  const keyboardHeight = useKeyboardState((keyboard) => keyboard.height);
  const workspace = useWorkspaceTabs()!;
  const { state } = workspace;
  // A tab keeps showing its own room while an aligned page leads the state by a frame.
  const room = use(WorkspaceRoomContext) ?? state.room;
  const selectedTab = workspaceRoomTab(state, room);
  const openAssistant = useOpenAssistantQuick();
  const assistantOrb = (systemTabBar || compactTabs) && room === "code" && openAssistant !== null;
  // Beside a split layout's open page, that page carries the call instead.
  const focused = useIsFocused();
  const callBar = useBotCallSummary() !== null && (!layout.usesSplitView || focused);
  const renderHeaderTitle = useCallback(
    () => (
      <WorkspaceRootTitle
        maxWidth={Math.max(0, width - 160)}
        onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
      />
    ),
    [width, navigation],
  );
  // Settings is a workspace tab too; its list takes the place of the selected tab's.
  const settingsOpen = workspace.settingsOpen;
  const tab = state.tabs[settingsOpen ? "settings" : selectedTab];
  const controlsClearance =
    layout.primarySidebarOverlaysContent && selectedTab === "usage"
      ? workspaceDockBottomClearance({ bottomInset: insets.bottom, keyboardHeight })
      : Platform.OS === "ios" && isDuoDevice(deviceType)
        ? workspaceSearchBottomClearance({
            bottomInset: insets.bottom,
            bottomBarInset,
            keyboardHeight,
          })
        : compactTabs || deviceType === "pad"
          ? workspaceDockBottomClearance({ bottomInset: insets.bottom, keyboardHeight })
          : Platform.OS === "ios"
            ? Math.max(insets.bottom, keyboardHeight) +
              (systemTabBar || sidebarTabs || tab.searchMode !== "resting"
                ? sidebarPicker
                  ? 80
                  : 16
                : WORKSPACE_DOCK.height + WORKSPACE_DOCK.bottomGap + 16)
            : keyboardHeight > 0 && tab.searchMode !== "resting"
              ? keyboardHeight + 64
              : Math.max(insets.bottom, 12) + workspaceToolbarHeight(tab.searchMode) + 16;
  const bottomClearance =
    controlsClearance +
    Math.max(assistantOrb ? ASSISTANT_ORB_CLEARANCE : 0, callBar ? CALL_BAR_CLEARANCE : 0);
  // The orb and call bar sit 12 points above the controls the list already clears.
  const floatingBottom = controlsClearance - 4;
  // On the compact bar the orb lines up over the compose circle that trails the tabs.
  const orbRight = 16;
  const context = useMemo(() => ({ ...workspace, bottomClearance }), [workspace, bottomClearance]);

  return (
    <WorkspaceTabsContext value={context}>
      <View
        className={`flex-1 ${sidebarPicker ? "bg-drawer" : surface.className}`}
        style={sidebarPicker ? { paddingTop: insets.top } : undefined}
      >
        {Platform.OS === "ios" ? (
          <NativeStackScreenOptions
            optionsVersion={[
              settingsOpen,
              selectedTab,
              state.selectionRevision,
              width,
              sidebarNavigation,
              enabled.length,
            ]}
            options={{
              title: settingsOpen
                ? "Settings"
                : enabled.length
                  ? TAB_TITLES[selectedTab]
                  : "Navigation",
              headerShown: true,
              headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
              headerStyle: NATIVE_LIQUID_GLASS_SUPPORTED
                ? { backgroundColor: "transparent" }
                : undefined,
              contentStyle: undefined,
              ...(enabled.length === 0
                ? { headerSearchBarOptions: undefined, unstable_headerRightItems: () => [] }
                : {}),
              unstable_headerLeftItems: () => [],
              // Beside a detail column the tab bar names the tab and the detail header the page,
              // so the sidebar keeps the brand.
              headerTitle:
                sidebarNavigation || (!settingsOpen && selectedTab !== "usage")
                  ? renderHeaderTitle
                  : undefined,
            }}
          />
        ) : (
          <AndroidScreenHeader
            title="T3 Code"
            titleContent={renderHeaderTitle()}
            actions={[
              ...(selectedTab === "threads" || selectedTab === "pullRequests"
                ? [
                    {
                      accessibilityLabel:
                        selectedTab === "threads" ? "Search threads" : "Search pull requests",
                      icon: "magnifyingglass" as const,
                      onPress: () => {
                        dispatchHardwareKeyboardCommand("focusSearch");
                      },
                    },
                  ]
                : []),
              {
                accessibilityLabel: "Settings",
                icon: "gearshape",
                onPress: () => selectTab("settings"),
              },
            ]}
          />
        )}
        <SafeAreaInsetsContext
          value={
            sidebarPicker ? { ...insets, top: 0 } : compactTabs ? { ...insets, bottom: 0 } : insets
          }
        >
          {settingsOpen ? (
            <SettingsRouteScreen />
          ) : enabled.length === 0 ? (
            <WorkspaceNoTabs />
          ) : selectedTab === "bots" ? (
            <BotsScreen />
          ) : selectedTab === "threads" ? (
            <HomeRouteScreen />
          ) : selectedTab === "pullRequests" ? (
            <PullRequestsScreen />
          ) : (
            <WorkspaceExtraTab tab={selectedTab} />
          )}
        </SafeAreaInsetsContext>
        {deviceType !== "pad" && deviceType !== "phone" && sidebarPicker ? (
          <WorkspaceSidebarTabs />
        ) : null}
        {enabled.length === 0 && !settingsOpen ? null : !settingsOpen && selectedTab === "bots" ? (
          <BotsToolbar />
        ) : (
            settingsOpen
              ? Platform.OS === "ios"
              : selectedTab === "threads" || selectedTab === "pullRequests"
          ) ? (
          <WorkspaceToolbar
            sidebar={sidebarNavigation}
            onNewTask={startNewTask}
            onOpenAssistant={assistantOrb ? undefined : (openAssistant ?? undefined)}
          />
        ) : (
          <WorkspaceSectionToolbar onNewTask={startNewTask} showCompose={false} />
        )}
        {assistantOrb && !(compactTabs && selectedTab === "threads" && !workspace.settingsOpen) ? (
          <AssistantOrb prominent style={{ right: orbRight, bottom: floatingBottom }} />
        ) : null}
        {callBar ? (
          <ActiveBotCallBar
            thread={null}
            className="absolute"
            style={{
              left: 16,
              right: assistantOrb ? orbRight + PROMINENT_ASSISTANT_ORB_SIZE + 10 : 16,
              bottom: floatingBottom,
            }}
          />
        ) : null}
      </View>
    </WorkspaceTabsContext>
  );
}

export function WorkspaceRootScreen() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs();
  return Platform.OS === "android" && layout.usesSplitView ? (
    <HomeRouteScreen />
  ) : workspace ? (
    <WorkspaceRootContent />
  ) : (
    <WorkspaceTabsProvider>
      <WorkspaceRootContent />
    </WorkspaceTabsProvider>
  );
}
