import { useWorkspaceSidebarHeaderItem } from "../layout/useWorkspaceSidebarHeaderItem";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { threadHeaderAppearance } from "./thread-header-appearance";
import { isDuoDevice } from "../../lib/device-type";
import type { AppNativeStackNavigationOptions } from "../../native/StackHeader";
import { useDeviceType } from "../../native/native-layout-metrics";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { BotHeaderTitle, type BotChatIdentity } from "../bots/BotHeaderTitle";
import { botThreadsAccessibilityLabel } from "../bots/bot-room";
import { useBotThreadBadge } from "../bots/use-bot-thread-badge";
import { useControlTheme } from "../../components/ui/useControlTheme";
import {
  ThreadGitControls,
  useThreadGitCenterHeaderItems,
  useThreadGitRightHeaderItems,
} from "./ThreadGitControls";

type NativeHeaderItems = ReadonlyArray<Record<string, unknown>>;

export function useThreadHeaderOptions(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly headerColor: string;
  readonly usesNativeHeaderGlass: boolean;
  readonly gitControls: Parameters<typeof ThreadGitControls>[0];
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  /** Bot chats only, and not on the conversation already on the call. */
  readonly onCall?: () => void;
  /**
   * Bot chats only: the header shows the bot, and tapping it opens the bot's profile. A bot chat
   * has no workspace, so the Code controls give way to its threads, Call, and Profile.
   */
  readonly botIdentity?: BotChatIdentity;
  /** Bot chats only: opens the bot's other threads. */
  readonly onOpenThreads?: () => void;
}) {
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const deviceType = useDeviceType();
  const usesDuoHeader = usesNativeWorkspaceColumns && isDuoDevice(deviceType);
  const navigation = useNavigation();
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const sidebarHeaderItem = useWorkspaceSidebarHeaderItem();
  const gitCenterHeaderItems = useThreadGitCenterHeaderItems(props.gitControls);
  const gitRightHeaderItems = useThreadGitRightHeaderItems(props.gitControls);
  const { onCall, botIdentity, onOpenThreads } = props;
  const onOpenBotProfile = botIdentity?.onPress;
  const { open: openThreads, needsYou: threadNeedsYou } = useBotThreadBadge(
    botIdentity?.project ?? null,
  );
  const { colors } = useControlTheme();
  const { width } = useWindowDimensions();
  const renderBotTitle = useCallback(
    () =>
      botIdentity ? <BotHeaderTitle {...botIdentity} maxWidth={Math.max(0, width - 200)} /> : null,
    [botIdentity, width],
  );
  const botHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      ...(onOpenThreads
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: botThreadsAccessibilityLabel({
                open: openThreads,
                needsYou: threadNeedsYou,
              }),
              icon: { name: "bubble.left.and.bubble.right", type: "sfSymbol" as const },
              identifier: "thread-right-bot-threads",
              label: "Threads",
              onPress: onOpenThreads,
              type: "button" as const,
              // Quiet until the bot has threads besides its main conversation.
              ...(openThreads > 0
                ? {
                    badge: {
                      value: String(openThreads),
                      style: {
                        color: colors["--color-screen"],
                        backgroundColor: threadNeedsYou
                          ? colors["--color-warning-foreground"]
                          : colors["--color-foreground"],
                      },
                    },
                  }
                : {}),
            }),
          ]
        : []),
      ...(onCall
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: "Call",
              icon: { name: "phone.fill", type: "sfSymbol" as const },
              identifier: "thread-right-call",
              label: "Call",
              onPress: onCall,
              type: "button" as const,
              variant: "prominent" as const,
            }),
          ]
        : []),
      ...(onOpenBotProfile
        ? [
            // Text, not a glyph, so the profile reads as a primary action beside Call.
            withNativeGlassHeaderItem({
              accessibilityLabel: "Profile",
              identifier: "thread-right-bot-profile",
              label: "Profile",
              onPress: onOpenBotProfile,
              type: "button" as const,
            }),
          ]
        : []),
    ],
    [onOpenThreads, onCall, onOpenBotProfile, openThreads, threadNeedsYou, colors],
  );
  const threadCenterHeaderItems = botIdentity ? botHeaderItems : gitCenterHeaderItems;
  const compactRightHeaderItems = botIdentity ? botHeaderItems : gitRightHeaderItems;
  const splitLeftHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      ...(!usesDuoHeader
        ? [
            {
              spacing: 18,
              type: "spacing" as const,
            },
          ]
        : []),
      ...(props.onReturnToThread
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: "Return to chat",
              icon: { name: "chevron.left", type: "sfSymbol" as const },
              identifier: "thread-left-return",
              onPress: props.onReturnToThread,
              type: "button" as const,
            }),
          ]
        : []),
      sidebarHeaderItem,
      ...(!usesDuoHeader && !props.draft
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: "New task",
              icon: { name: "square.and.pencil", type: "sfSymbol" as const },
              identifier: "thread-left-new-task",
              label: "New task",
              onPress: startNewTask,
              type: "button" as const,
            }),
          ]
        : []),
    ],
    [sidebarHeaderItem, props.onReturnToThread, props.draft, startNewTask, usesDuoHeader],
  );
  const canGoBack = navigation.canGoBack();
  const compactHomeHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      withNativeGlassHeaderItem({
        accessibilityLabel: "Go to threads list",
        icon: { name: "list.bullet", type: "sfSymbol" as const },
        identifier: "thread-left-home",
        onPress: () => navigation.dispatch(StackActions.replace("Home")),
        type: "button" as const,
      }),
    ],
    [navigation],
  );

  const options: AppNativeStackNavigationOptions = {
    ...threadHeaderAppearance(props.usesNativeHeaderGlass),
    headerTitle: botIdentity ? renderBotTitle : props.title,
    title: props.title,
    headerBackVisible: !layout.usesSplitView,
    unstable_headerLeftItems: layout.usesSplitView
      ? () => splitLeftHeaderItems
      : canGoBack
        ? undefined
        : () => compactHomeHeaderItems,
    // The workspace navigator adds compose to the Duo detail column's bar.
    unstable_headerRightItems: () =>
      usesDuoHeader || layout.usesSplitView ? threadCenterHeaderItems : compactRightHeaderItems,
    unstable_headerToolbarItems: () => [],
    unstable_headerSubtitle:
      props.usesNativeHeaderGlass && !botIdentity ? props.subtitle : undefined,
    contentStyle: undefined,
  };
  const { environmentId, threadId, gitStatus } = props.gitControls;
  return {
    options,
    // Factories re-read only on version changes; include displayed items and hidden callback state such as default refs.
    optionsVersion: [
      splitLeftHeaderItems,
      threadCenterHeaderItems,
      compactRightHeaderItems,
      usesDuoHeader,
      environmentId,
      threadId,
      gitStatus?.isDefaultRef,
      gitStatus?.refName,
      gitStatus?.pr?.url,
      // The bot title renders through a stabilized factory, so what it shows is keyed here.
      botIdentity?.project.title,
      botIdentity?.project.projectIcon,
      botIdentity?.project.faviconPath,
      botIdentity?.topic,
      width,
    ],
    threadsBadge: { open: openThreads, needsYou: threadNeedsYou },
    sidebar: false,
    fallback:
      !botIdentity && !layout.usesSplitView && !props.usesNativeHeaderGlass ? (
        <ThreadGitControls {...props.gitControls} showActionControls />
      ) : null,
  };
}
