import { useMemo } from "react";
import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { ScreenHeaderButton } from "../../components/ui/ScreenHeaderButton";
import type { AppBarAction } from "../../components/ui/AppBar.types";
import { cn } from "../../lib/cn";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { botThreadsAccessibilityLabel } from "../bots/bot-room";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { layout, panes, composerKeyboardActive } = useAdaptiveWorkspaceLayout();
  const navigation = useNavigation();
  const { devServers, onOpenDevServer, onOpenTerminal, onMergeBack } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const androidHeaderActions = useMemo<ReadonlyArray<AppBarAction>>(() => {
    const actions: AppBarAction[] = [];
    // A bot chat has no workspace; its Threads, Call, and Profile render in the trailing slot.
    if (props.botIdentity) return actions;
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: "Return to chat",
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      actions.push({
        accessibilityLabel: "Open files",
        icon: "folder",
        onPress: () =>
          navigation.navigate("ThreadFiles", {
            environmentId: String(props.gitControls.environmentId),
            threadId: String(props.gitControls.threadId),
          }),
      });
    }
    if (props.hasWorkspaceRoot && props.gitControls.canOpenTerminal) {
      actions.push({
        accessibilityLabel: "Open terminal",
        icon: "terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    if (devServers.length > 0) {
      const firstReachable = devServers.find((entry) => entry.reachable) ?? devServers[0]!;
      actions.push({
        accessibilityLabel: "Open dev server",
        icon: "globe",
        onPress: () => void onOpenDevServer(firstReachable),
      });
    }
    actions.push({
      accessibilityLabel: "Open git",
      icon: "point.topleft.down.curvedto.point.bottomright.up",
      onPress: () =>
        navigation.navigate("ThreadReview", {
          environmentId: String(props.gitControls.environmentId),
          threadId: String(props.gitControls.threadId),
        }),
    });
    if (onMergeBack) {
      actions.push({
        accessibilityLabel: "Merge back to source",
        icon: PullRequestGlyph.merged,
        onPress: onMergeBack,
      });
    }
    return actions;
  }, [
    devServers,
    onOpenDevServer,
    onOpenTerminal,
    onMergeBack,
    props.onReturnToThread,
    props.botIdentity,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
    props.gitControls.canOpenTerminal,
    props.gitControls.environmentId,
    props.gitControls.threadId,
    navigation,
  ]);

  return (
    <>
      <AppBar
        title={props.botIdentity ? props.botIdentity.project.title : props.title}
        subtitle={props.botIdentity ? (props.botIdentity.topic ?? undefined) : props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={native.optionsVersion}
        trailing={
          props.botIdentity ? (
            <View className="flex-row items-center gap-2 pr-1">
              {props.onOpenThreads ? (
                <View>
                  <ScreenHeaderButton
                    accessibilityLabel={botThreadsAccessibilityLabel(native.threadsBadge)}
                    icon="bubble.left.and.bubble.right"
                    onPress={props.onOpenThreads}
                  />
                  {native.threadsBadge.open > 0 ? (
                    <View
                      pointerEvents="none"
                      className={cn(
                        "absolute -right-0.5 -top-0.5 min-w-[18px] items-center rounded-full border-2 border-header px-1",
                        native.threadsBadge.needsYou ? "bg-warning-foreground" : "bg-foreground",
                      )}
                    >
                      <Text className="text-[10px] font-t3-bold text-screen">
                        {native.threadsBadge.open}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {props.onCall ? (
                <ControlPill icon="phone" label="Call" variant="primary" onPress={props.onCall} />
              ) : null}
              <ControlPill
                icon="person.crop.circle"
                label="Profile"
                variant="pill"
                onPress={props.botIdentity.onPress}
              />
            </View>
          ) : props.fileInspectorSupported && props.hasThreadCwd ? (
            <ScreenHeaderButton
              accessibilityLabel={
                props.inspectorMode !== null && panes.auxiliaryPaneVisible
                  ? "Hide inspector"
                  : "Show inspector"
              }
              icon="sidebar.right"
              selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
              onPress={props.onToggleInspector}
            />
          ) : null
        }
        onBack={layout.usesSplitView ? undefined : goBack}
        actions={androidHeaderActions}
        hideBottomBorder
        compact={composerKeyboardActive}
      />
      {native.fallback}
    </>
  );
}
