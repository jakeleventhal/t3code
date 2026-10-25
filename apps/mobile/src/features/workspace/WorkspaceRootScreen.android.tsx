import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { useEnabledNavigationTabs } from "./navigation-tabs";
import { NAVIGATION_TAB_ORDER } from "./navigation-tab-order";
import { WorkspaceExtraTab } from "./WorkspaceExtraTab";
import { useMemo } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { PullRequestFilterMenuProvider } from "../pull-requests/PullRequestFilterMenuContext";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { AndroidWorkspaceNavigation } from "./AndroidWorkspaceNavigation";
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
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs()!;
  const enabled = useEnabledNavigationTabs();
  const insets = useSafeAreaInsets();
  const { fabClearance, fabSize } = useAndroidControlSizing();
  const tab = workspace.state.selectedTab;
  const assistantEnvironmentId = useAssistantEnvironmentId();
  // The Assistant floats over Code's lists, stacked above New thread where Threads shows it.
  const assistantOrb =
    (tab === "threads" || tab === "pullRequests") && assistantEnvironmentId !== null;
  const callBar = useBotCallSummary() !== null;
  const context = useMemo(
    () => ({
      ...workspace,
      bottomClearance:
        tab === "threads"
          ? fabClearance + 16
          : 16 +
            // Where no New thread sits below it, the list clears the Assistant button alone.
            Math.max(assistantOrb ? fabSize + 12 : 0, callBar ? CALL_BAR_CLEARANCE : 0),
    }),
    [workspace, fabClearance, fabSize, tab, assistantOrb, callBar],
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
        <View className="flex-1">
          <SafeAreaInsetsContext value={{ ...insets, bottom: 0 }}>
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
                    <PullRequestFilterMenuProvider>
                      <PullRequestToolbar />
                      <ScreenContent>
                        <PullRequestsScreen />
                      </ScreenContent>
                    </PullRequestFilterMenuProvider>
                  )
                }
              />
            )}
          </SafeAreaInsetsContext>
          {assistantOrb ? (
            <AssistantOrb
              prominent
              style={{ right: 16, bottom: tab === "threads" ? 16 + fabSize + 12 : 16 }}
            />
          ) : null}
          {callBar ? (
            <ActiveBotCallBar
              thread={null}
              className="absolute"
              style={{
                left: 16,
                right: tab === "threads" || assistantOrb ? 16 + fabSize + 12 : 16,
                bottom: 16,
              }}
            />
          ) : null}
        </View>
        <AndroidWorkspaceNavigation onNewThread={startNewTask} />
      </View>
    </WorkspaceTabsContext>
  );
}
