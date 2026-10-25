import { useAndroidFloatingTabs } from "../settings/appearance/AppearancePreferencesProvider";
import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { useEnabledNavigationTabs } from "./navigation-tabs";
import { NAVIGATION_TAB_ORDER } from "./navigation-tab-order";
import { WorkspaceExtraTab } from "./WorkspaceExtraTab";
import { useMemo } from "react";
import { useWindowDimensions, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { AndroidWorkspaceNavigation, FloatingWorkspaceTabs } from "./AndroidWorkspaceNavigation";
import { FLOATING_TABS, floatingTabsMetrics } from "./floating-workspace-tabs";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";
import type { WorkspaceTab } from "./workspace-tabs-state";
import { ActiveBotCallBar } from "../bots/ActiveBotCall";
import { AssistantOrb } from "../bots/AssistantOrb";
import { BotsAndroidHeader } from "../bots/BotsAndroidHeader";
import { BotsScreen } from "../bots/BotsScreen";
import { useAssistantEnvironmentId } from "../bots/use-assistant";
import { useBotCallSummary } from "../bots/use-bot-call";

const TABS: readonly WorkspaceTab[] = NAVIGATION_TAB_ORDER;
// Clears the list behind the call bar, which sits beside New thread in Code.
const CALL_BAR_CLEARANCE = 66;

function BotsPane() {
  return (
    <>
      <BotsAndroidHeader />
      <ScreenContent>
        <BotsScreen />
      </ScreenContent>
    </>
  );
}

export function WorkspaceRootScreen() {
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs()!;
  const enabled = useEnabledNavigationTabs();
  const insets = useSafeAreaInsets();
  const { fabClearance, scale, fabSize } = useAndroidControlSizing();
  const window = useWindowDimensions();
  const floating = floatingTabsMetrics(enabled.length + 1, scale, fabSize, window.width);
  const tab = workspace.state.selectedTab;
  const assistantEnvironmentId = useAssistantEnvironmentId();
  // The Assistant floats over Code's lists, stacked above New thread where Threads shows it.
  const assistantOrb =
    (tab === "threads" || tab === "pullRequests") && assistantEnvironmentId !== null;
  const callBar = useBotCallSummary() !== null;
  const context = useMemo(
    () => ({
      ...workspace,
      bottomClearance: Math.max(assistantOrb ? ASSISTANT_ORB_CLEARANCE : 0, callBar ? CALL_BAR_CLEARANCE : 0) + (floatingTabsEnabled
        ? insets.bottom +
          FLOATING_TABS.bottom +
          FLOATING_TABS.edge +
          Math.max(
            floating.height,
            workspace.state.selectedTab === "threads" ? floating.fabOffset + fabSize : 0,
          )
        : workspace.state.selectedTab === "threads"
          ? fabClearance + 16
          : 16),
    }),
    [
      assistantOrb, callBar,
      floatingTabsEnabled,
      workspace,
      fabClearance,
      insets.bottom,
      floating.height,
      floating.fabOffset,
      fabSize,
    ],
  );

  if (layout.usesSplitView) {
    if (enabled.length === 0) return <View className="flex-1 bg-screen" />;
    return (
      <>
        <WorkspaceTabPanes
          tabs={TABS}
          selected={tab}
          renderTab={(tab) =>
            tab === "threads" ? (
              <HomeRouteScreen />
            ) : tab === "bots" ? (
              <>
                <NativeStackScreenOptions options={{ headerShown: false }} />
                <AndroidScreenHeader title="Bots" />
                <View className="flex-1 items-center justify-center px-10">
                  <EmptyState
                    title="Select a conversation"
                    detail="Choose a bot from the sidebar."
                    variant="plain"
                  />
                </View>
              </>
            ) : tab !== "pullRequests" ? (
              <WorkspaceExtraTab tab={tab} />
            ) : (
              <>
                <NativeStackScreenOptions options={{ headerShown: false }} />
                <AndroidScreenHeader title="Pull requests" />
                <View className="flex-1 items-center justify-center px-10">
                  <EmptyState
                    title="Select a pull request"
                    detail="Choose a pull request from the sidebar to review it."
                    variant="plain"
                  />
                </View>
              </>
            )
          }
        />
        {callBar ? (
          <ActiveBotCallBar
            thread={null}
            className="absolute"
            style={{ left: 16, right: 16, bottom: insets.bottom + 16 }}
          />
        ) : null}
      </>
    );
  }

  return (
    <WorkspaceTabsContext value={context}>
      <View className="flex-1 bg-header">
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <SafeAreaInsetsContext
          value={
            floatingTabsEnabled
              ? tab === "usage"
                ? { ...insets, bottom: context.bottomClearance }
                : insets
              : { ...insets, bottom: 0 }
          }
        >
          {enabled.length === 0 ? (
            <WorkspaceNoTabs />
          ) : (
            <WorkspaceTabPanes
              tabs={TABS}
              selected={tab}
              renderTab={(tab) =>
                tab === "threads" ? (
                  <HomeRouteScreen />
                ) : tab === "bots" ? (
                  <BotsPane />
                ) : tab !== "pullRequests" ? (
                  <WorkspaceExtraTab tab={tab} />
                ) : (
                  <PullRequestsScreen
                    renderFrame={(filters, list) => (
                      <>
                        <PullRequestToolbar filters={filters} />
                        <ScreenContent>{list}</ScreenContent>
                      </>
                    )}
                  />
                )
              }
            />
          )}
        </SafeAreaInsetsContext>
        {assistantOrb ? (
          <AssistantOrb environmentId={assistantEnvironmentId} style={{ right: 16, bottom: context.bottomClearance - ASSISTANT_ORB_CLEARANCE + 8 }} />
        ) : null}
        {callBar ? (
          <ActiveBotCallBar thread={null} className="absolute" style={{ left: 16, right: assistantOrb ? 16 + fabSize + 12 : 16, bottom: context.bottomClearance - CALL_BAR_CLEARANCE + 8 }} />
        ) : null}
        {floatingTabsEnabled ? (
          <FloatingWorkspaceTabs fillWidth onNewThread={startNewTask} />
        ) : (
          <AndroidWorkspaceNavigation onNewThread={startNewTask} />
        )}
      </View>
    </WorkspaceTabsContext>
  );
}
