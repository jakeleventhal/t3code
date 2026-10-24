import { openSettings } from "../settings/settings-navigation";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";
import { use, useMemo, useState, type ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListSection } from "../../components/ui/ListSection";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { relativeTime } from "../../lib/time";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useProjects } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useAtomValueWhileVisible, useHomeRouteVisible } from "../home/home-route-visibility";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  botThreadStatus,
  buildBotRoom,
  type BotRoomBot,
  type BotRoomEnvironment,
} from "./bot-room";
import { BotAvatar } from "./BotAvatar";
import { useBotAvailability, useOpenBotConversation } from "./use-bot-conversation";

const TOPIC_PREVIEW_LIMIT = 4;

function updatedLabel(timestamp: string): string {
  const age = relativeTime(timestamp);
  return age === "<1m" ? "Updated just now" : `Updated ${age} ago`;
}

function statusLabel(thread: EnvironmentThreadShell | null): string | null {
  if (thread === null) return null;
  const status = botThreadStatus(thread);
  return status === "needs-you" ? "Needs you" : status === "working" ? "Working…" : null;
}

/**
 * Navigation shells leave archived threads out, so a main conversation the project names but the
 * list lacks is archived or gone. The server can bring it back; a read-only device opens it as is.
 */
function knownMainThread(bot: BotRoomBot) {
  if (bot.mainThread !== null) return { id: bot.mainThread.id, archived: false };
  const id = bot.project?.botMainThreadId ?? null;
  return id === null ? null : { id, archived: true };
}

function BotRow(props: {
  readonly leading: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly selected: boolean;
  readonly attention: boolean;
  readonly pending?: boolean;
  readonly disabled?: boolean;
  readonly inset?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title}, ${props.subtitle}`}
      accessibilityState={{ disabled: Boolean(props.disabled), selected: props.selected }}
      disabled={props.disabled || props.pending}
      onPress={props.onPress}
      className={props.selected ? "bg-thread-selected" : "bg-grouped-card"}
    >
      <View
        className={cn(
          "flex-row items-center gap-3 py-3 pr-4",
          props.inset ? "min-h-12 pl-14" : "min-h-16 pl-4",
          props.disabled && "opacity-45",
        )}
      >
        {props.leading}
        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            textRole={props.inset ? "footnote" : "body"}
            className={cn(
              props.inset ? "text-foreground" : "font-t3-medium text-foreground",
              props.selected && "text-thread-selected-foreground",
            )}
            numberOfLines={1}
          >
            {props.title}
          </Text>
          <Text
            textRole={props.inset ? "caption" : "footnote"}
            className={props.attention ? "text-warning-foreground" : "text-foreground-muted"}
            numberOfLines={1}
          >
            {props.subtitle}
          </Text>
        </View>
        {props.pending ? <AppActivityIndicator size="small" /> : null}
      </View>
    </RowPressable>
  );
}

function ActionRow(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly inset?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className="bg-grouped-card"
    >
      <View
        className={cn(
          "min-h-12 flex-row items-center gap-3 py-3 pr-4",
          props.inset ? "pl-14" : "pl-4",
        )}
      >
        <SymbolView name={props.icon} size={16} tintColorClassName="accent-icon-muted" />
        <Text textRole="footnote" className="text-foreground-muted">
          {props.label}
        </Text>
      </View>
    </RowPressable>
  );
}

function BotGroup(props: {
  readonly bot: BotRoomBot;
  readonly connected: boolean;
  readonly selectedThreadKey: string | null;
  readonly title?: string;
}) {
  const { bot } = props;
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const opener = useOpenBotConversation(bot.environmentId);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const mainKey = bot.mainThread ? scopedThreadKey(bot.environmentId, bot.mainThread.id) : null;
  const status = statusLabel(bot.mainThread);
  // Nothing loaded to read, and this device or server cannot create or reopen it.
  const unavailable = !opener.canStart && knownMainThread(bot) === null;
  const subtitle =
    !props.connected && bot.mainThread === null
      ? "Offline"
      : unavailable
        ? "Unavailable"
        : (status ??
          (bot.mainThread
            ? updatedLabel(bot.mainThread.updatedAt)
            : bot.project?.botMainThreadId
              ? "Reopen conversation"
              : bot.role === "assistant"
                ? "Start a conversation"
                : "No messages yet"));
  const topics = showAllTopics ? bot.topics : bot.topics.slice(0, TOPIC_PREVIEW_LIMIT);
  const hiddenTopics = bot.topics.length - topics.length;
  return (
    <ListSection
      title={props.title}
      footer={unavailable ? (opener.reason ?? undefined) : undefined}
    >
      <BotRow
        leading={<BotAvatar role={bot.role} title={bot.title} size={36} project={bot.project} />}
        title={bot.title}
        subtitle={subtitle}
        attention={status === "Needs you"}
        selected={mainKey !== null && mainKey === props.selectedThreadKey}
        pending={opener.pending}
        disabled={(!props.connected && bot.mainThread === null) || unavailable}
        onPress={async () => {
          const target = await opener.open({
            projectId: bot.project?.id ?? null,
            known: knownMainThread(bot),
            title: bot.title,
          });
          if (target)
            selectDetail({
              name: "Thread",
              params: { environmentId: target.environmentId, threadId: target.threadId },
            });
        }}
      />
      {topics.map((topic) => {
        const topicStatus = statusLabel(topic);
        return (
          <BotRow
            key={topic.id}
            inset
            leading={null}
            title={topic.title}
            subtitle={topicStatus ?? relativeTime(topic.updatedAt)}
            attention={topicStatus === "Needs you"}
            selected={scopedThreadKey(topic.environmentId, topic.id) === props.selectedThreadKey}
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: { environmentId: topic.environmentId, threadId: topic.id },
              })
            }
          />
        );
      })}
      {hiddenTopics > 0 ? (
        <ActionRow
          inset
          icon="chevron.down"
          label={`${hiddenTopics} more`}
          onPress={() => setShowAllTopics(true)}
        />
      ) : null}
      {bot.project !== null && opener.canStart ? (
        <ActionRow
          inset
          icon="plus"
          label="New conversation"
          onPress={() =>
            navigation.navigate("Thread", {
              draft: {
                requestId: uuidv4(),
                environmentId: String(bot.environmentId),
                projectId: String(bot.project!.id),
                title: bot.title,
              },
            })
          }
        />
      ) : null}
    </ListSection>
  );
}

function BotsEnvironment(props: {
  readonly environment: BotRoomEnvironment;
  readonly connected: boolean;
  readonly showLabel: boolean;
  readonly selectedThreadKey: string | null;
}) {
  const { environment } = props;
  const navigation = useNavigation();
  const canCreate = useBotAvailability(environment.environmentId).canStart;
  return (
    <View className="gap-5">
      {props.showLabel ? (
        <Text textRole="headline" className="px-2 font-t3-bold text-foreground">
          {environment.label}
        </Text>
      ) : null}
      <BotGroup
        bot={environment.assistant}
        connected={props.connected}
        selectedThreadKey={props.selectedThreadKey}
      />
      {environment.specialists.map((bot, index) => (
        <BotGroup
          key={bot.key}
          bot={bot}
          connected={props.connected}
          selectedThreadKey={props.selectedThreadKey}
          title={index === 0 ? "Specialists" : undefined}
        />
      ))}
      {canCreate && props.connected ? (
        <ListSection>
          <ActionRow
            icon="plus"
            label="New bot"
            onPress={() =>
              navigation.navigate("NewBot", { environmentId: String(environment.environmentId) })
            }
          />
        </ListSection>
      ) : null}
    </View>
  );
}

function BotsScrollView(props: { readonly children: ReactNode; readonly bottom: number }) {
  const insets = useSafeAreaInsets();
  const primaryColumn = use(NativePrimaryColumnContext);
  const contentContainerStyle = {
    gap: 28,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 12 : 16,
    paddingBottom: props.bottom,
  };
  if (Platform.OS !== "ios") {
    return (
      <ScrollView className="flex-1" contentContainerStyle={contentContainerStyle}>
        {props.children}
      </ScrollView>
    );
  }
  // Registered with its screen so UIKit can minimize the tab bar and fade the header on scroll.
  return (
    <ScrollViewMarker style={{ flex: 1 }}>
      <ScrollView
        className={primaryColumn ? "bg-drawer" : "bg-screen"}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentInset={{ top: insets.top }}
        contentOffset={{ x: 0, y: -insets.top }}
        scrollIndicatorInsets={{ top: insets.top }}
        contentContainerStyle={contentContainerStyle}
      >
        {props.children}
      </ScrollView>
    </ScrollViewMarker>
  );
}

export function BotsScreen() {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const insets = useSafeAreaInsets();
  const primaryColumn = use(NativePrimaryColumnContext);
  const projects = useProjects();
  // Streaming turns rewrite thread shells many times a second; skip that while a chat covers us.
  const visible = useHomeRouteVisible();
  const threads = useAtomValueWhileVisible(
    environmentThreadShells.navigationThreadShellsAtom,
    visible,
  );
  const environments = useWorkspaceEnvironments();
  const shown = useMemo(
    () =>
      environments
        .filter((environment) => environment.isEnabled)
        .sort((left, right) => left.environmentLabel.localeCompare(right.environmentLabel)),
    [environments],
  );
  const room = useMemo(
    () =>
      buildBotRoom({
        environments: shown.map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.environmentLabel,
        })),
        projects,
        threads,
      }),
    [shown, projects, threads],
  );
  const bottom = Math.max(insets.bottom, workspace?.bottomClearance ?? 16) + 16;

  if (room.length === 0) {
    return (
      <View className="flex-1 justify-center bg-screen">
        <EmptyState
          variant="plain"
          title="No environments"
          detail="Bots live on an environment. Add one to start talking to your Assistant."
          actionLabel="Add environment"
          onAction={() => openSettings(navigation, "SettingsEnvironmentNew")}
        />
      </View>
    );
  }

  return (
    <BotsScrollView bottom={bottom}>
      {room.map((environment) => (
        <BotsEnvironment
          key={environment.environmentId}
          environment={environment}
          connected={
            shown.find((entry) => entry.environmentId === environment.environmentId)
              ?.connectionState === "connected"
          }
          showLabel={room.length > 1}
          selectedThreadKey={primaryColumn?.selectedThreadKey ?? null}
        />
      ))}
    </BotsScrollView>
  );
}
