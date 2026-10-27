import { openSettings } from "../settings/settings-navigation";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeScrollViewMarker } from "../../native/NativeScrollViewMarker";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { RowPressable } from "../../components/ui/RowPressable";
import { SearchField } from "../../components/ui/SearchField";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { relativeTime } from "../../lib/time";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { environmentThreadShells } from "../../state/threads";
import { useThreadOutboxMessages } from "../../state/use-thread-outbox";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useAtomValueWhileVisible, useHomeRouteVisible } from "../home/home-route-visibility";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { buildBotInbox, type BotInboxEntry, type BotRoomBot } from "./bot-room";
import { BotAvatar } from "./BotAvatar";
import { botsSearchQueryAtom, setBotsSearchQuery } from "./bots-header";
import { useAssistantEnvironmentId, useBotProjects } from "./use-assistant";
import { useOpenBotConversation } from "./use-bot-conversation";

const InboxViewportContext = createContext({ top: 0, height: 0, active: false });
const InboxPlaybackContext = createContext(false);

function InboxPlaybackFrame({ children }: { readonly children: ReactNode }) {
  const viewport = use(InboxViewportContext);
  const [bounds, setBounds] = useState({ y: 0, height: 0 });
  const visible =
    viewport.active &&
    bounds.height > 0 &&
    viewport.height > 0 &&
    bounds.y < viewport.top + viewport.height &&
    bounds.y + bounds.height > viewport.top;
  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => setBounds({ y: layout.y, height: layout.height })}
    >
      <InboxPlaybackContext value={visible}>{children}</InboxPlaybackContext>
    </View>
  );
}
const HERO_AVATAR_SIZE = 96;
const ROW_AVATAR_SIZE = 56;

/**
 * Navigation shells leave archived threads out, so a main conversation the project names but the
 * list lacks is archived or gone. The server can bring it back; a read-only device opens it as is.
 */
function knownMainThread(bot: BotRoomBot) {
  if (bot.mainThread !== null) return { id: bot.mainThread.id, archived: false };
  const id = bot.project?.botMainThreadId ?? null;
  return id === null ? null : { id, archived: true };
}

function inboxTime(at: string | null): string | null {
  if (at === null) return null;
  const age = relativeTime(at);
  return age === "<1m" ? "now" : age;
}

/** Open the conversation advertised by the preview; otherwise use Main. */
function useInboxEntryOpener(entry: BotInboxEntry, mainOnly = false) {
  const { bot } = entry;
  const selectDetail = useSelectWorkspaceDetail();
  const opener = useOpenBotConversation(bot.environmentId);
  const known = knownMainThread(bot);
  // Nothing loaded to read, and this device or server cannot create or reopen it.
  const unavailable = !opener.canStart && known === null;
  return {
    pending: opener.pending,
    disabled: (!entry.connected && bot.mainThread === null) || unavailable,
    reason: unavailable ? opener.reason : null,
    open: async () => {
      if (!mainOnly && entry.previewThread && entry.previewThread.id !== bot.mainThread?.id) {
        selectDetail({
          name: "Thread",
          params: { environmentId: bot.environmentId, threadId: entry.previewThread.id },
        });
        return;
      }
      const target = await opener.open({
        projectId: bot.project?.id ?? null,
        known,
        title: bot.title,
      });
      if (target)
        selectDetail({
          name: "Thread",
          params: { environmentId: target.environmentId, threadId: target.threadId },
        });
    },
  };
}

function useStatusColor(entry: BotInboxEntry): string | null {
  const { colors } = useControlTheme();
  return entry.status === "offline"
    ? colors["--color-foreground-tertiary"]
    : entry.status === "needs-you"
      ? colors["--color-warning-foreground"]
      : entry.status === "working"
        ? colors["--color-primary-text"]
        : null;
}

function InboxAvatar(props: { readonly entry: BotInboxEntry; readonly size: number }) {
  const { bot } = props.entry;
  const visible = use(InboxPlaybackContext);
  const statusColor = useStatusColor(props.entry);
  const dot = Math.round(props.size * 0.26);
  return (
    <View style={{ width: props.size, height: props.size }}>
      <View className={props.entry.status === "offline" ? "opacity-50" : undefined}>
        <BotAvatar
          role={bot.role}
          title={bot.title}
          size={props.size}
          project={bot.project}
          live={visible}
        />
      </View>
      {statusColor === null ? null : (
        <View
          pointerEvents="none"
          className="absolute border-screen"
          style={{
            right: 0,
            bottom: 0,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            borderWidth: Math.max(2, Math.round(dot / 5)),
            backgroundColor: statusColor,
          }}
        />
      )}
    </View>
  );
}

function InboxBadges({ entry }: { readonly entry: BotInboxEntry }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {entry.needsAttention ? (
        <SymbolView
          name="exclamationmark.circle"
          size={18}
          tintColorClassName="accent-warning-foreground"
          accessibilityLabel="Needs attention"
        />
      ) : null}
      {entry.unread ? (
        <View
          className="size-2.5 shrink-0 rounded-full bg-blue-500"
          accessible
          accessibilityLabel="Unread reply"
        />
      ) : null}
    </View>
  );
}

/** The status word leads the second line in its own colour; the rest is the preview. */
function InboxSummary(props: {
  readonly entry: BotInboxEntry;
  readonly reason: string | null;
  readonly time?: string | null;
  readonly centered?: boolean;
  readonly numberOfLines: number;
  readonly showPreview?: boolean;
}) {
  const { entry } = props;
  const status =
    entry.status === "offline"
      ? { label: "Offline", className: "font-t3-medium text-foreground-muted" }
      : entry.status === "needs-you"
        ? {
            label: entry.needsThread ? `↳ ${entry.needsThread.title} · Needs you` : "Needs you",
            className: "font-t3-medium text-warning-foreground",
          }
        : entry.status === "working"
          ? { label: "Working", className: "font-t3-medium text-primary-text" }
          : null;
  // A thread that needs the user says more than the main conversation's last line.
  const preview =
    props.reason ?? (entry.needsThread || props.showPreview === false ? null : entry.preview);
  const parts = [unsentLabel(entry.unsent), preview, props.time ?? null].filter(
    (part) => part !== null,
  );
  return (
    <Text
      textRole="footnote"
      numberOfLines={props.numberOfLines}
      className={cn("text-foreground-muted", props.centered ? "text-center" : "min-w-0 flex-1")}
    >
      {status ? <Text className={status.className}>{status.label}</Text> : null}
      {status && parts.length > 0 ? " · " : ""}
      {parts.join(" · ")}
    </Text>
  );
}

/** Held on this device, not by the host, so it never claims more than "not sent yet". */
function unsentLabel(count: number): string | null {
  return count === 0 ? null : `${count} waiting to send`;
}

function accessibilityLabel(entry: BotInboxEntry, reason: string | null, showPreview = true) {
  const status =
    entry.status === "offline"
      ? "Offline"
      : entry.status === "needs-you"
        ? entry.needsThread
          ? `${entry.needsThread.title} needs you`
          : "Needs you"
        : entry.status === "working"
          ? "Working"
          : null;
  const time = entry.activityAt === null ? null : relativeTime(entry.activityAt);
  return [
    entry.bot.title,
    entry.hostLabel,
    status,
    unsentLabel(entry.unsent),
    reason ?? (showPreview ? entry.preview : null),
    time === null ? null : time === "<1m" ? "just now" : `${time} ago`,
    entry.unread ? "New reply" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

/** The Assistant leads Bots the way its orb leads Chats: one tap into its main conversation. */
function AssistantHero(props: { readonly entry: BotInboxEntry; readonly selected: boolean }) {
  const { entry } = props;
  const opener = useInboxEntryOpener(entry, true);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(entry, opener.reason)}
      accessibilityState={{ disabled: opener.disabled, selected: props.selected }}
      disabled={opener.disabled || opener.pending}
      onPress={opener.open}
      className={cn(
        "mx-4 items-center gap-1.5 rounded-3xl px-6 pb-4 pt-2 active:opacity-70",
        props.selected && "bg-thread-selected",
        opener.disabled && "opacity-45",
      )}
    >
      <InboxAvatar entry={entry} size={HERO_AVATAR_SIZE} />
      <View className="flex-row items-center gap-2">
        <Text
          textRole="headline"
          numberOfLines={1}
          className={cn(
            "font-t3-semibold text-foreground",
            props.selected && "text-thread-selected-foreground",
          )}
        >
          {entry.bot.title}
        </Text>
        {entry.hostLabel ? (
          <Text textRole="footnote" className="text-foreground-tertiary">
            {entry.hostLabel}
          </Text>
        ) : null}
        {opener.pending ? <AppActivityIndicator size="small" /> : <InboxBadges entry={entry} />}
      </View>
      <View className="max-w-[300px]">
        <InboxSummary entry={entry} reason={opener.reason} centered numberOfLines={2} />
      </View>
    </Pressable>
  );
}

function BotInboxRow(props: { readonly entry: BotInboxEntry; readonly selected: boolean }) {
  const { entry } = props;
  const opener = useInboxEntryOpener(entry);
  const time = inboxTime(entry.activityAt);
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(entry, opener.reason)}
      accessibilityState={{ disabled: opener.disabled, selected: props.selected }}
      disabled={opener.disabled || opener.pending}
      onPress={opener.open}
      className={props.selected ? "bg-thread-selected" : undefined}
    >
      <View
        className={cn(
          "min-h-[78px] flex-row items-center gap-3.5 px-4 py-3",
          opener.disabled && "opacity-45",
        )}
      >
        <InboxAvatar entry={entry} size={ROW_AVATAR_SIZE} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <Text
              textRole="headline"
              numberOfLines={1}
              className={cn(
                "min-w-0 flex-1 text-foreground",
                entry.unread ? "font-t3-bold" : "font-t3-semibold",
                props.selected && "text-thread-selected-foreground",
              )}
            >
              {entry.bot.title}
              {entry.hostLabel ? (
                <Text className="font-sans text-foreground-tertiary">{` · ${entry.hostLabel}`}</Text>
              ) : null}
            </Text>
            {time ? (
              <Text
                textRole="caption"
                className={
                  entry.unread ? "font-t3-semibold text-primary-text" : "text-foreground-tertiary"
                }
              >
                {time}
              </Text>
            ) : null}
          </View>
          <View className="flex-row items-center gap-2">
            <InboxSummary entry={entry} reason={opener.reason} numberOfLines={1} />
            {opener.pending ? <AppActivityIndicator size="small" /> : <InboxBadges entry={entry} />}
          </View>
        </View>
      </View>
    </RowPressable>
  );
}

function BotsSearch(props: { readonly query: string }) {
  const inputRef = useRef<TextInputInstance>(null);
  return (
    <View className="flex-row items-center gap-3 px-4">
      <SearchField
        inputRef={inputRef}
        accessibilityLabel="Search bots"
        clearAccessibilityLabel="Clear search"
        placeholder="Search bots and messages"
        value={props.query}
        onChangeText={setBotsSearchQuery}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close search"
        onPress={() => setBotsSearchQuery(null)}
        className="py-2 active:opacity-60"
      >
        <Text textRole="body" className="text-primary-text">
          Cancel
        </Text>
      </Pressable>
    </View>
  );
}

function BotsScrollView(props: {
  readonly children: ReactNode;
  readonly bottom: number;
  readonly active: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState({ top: -insets.top, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setViewport((previous) => (previous.height === height ? previous : { ...previous, height }));
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    setViewport({ top: contentOffset.y, height: layoutMeasurement.height });
  };
  const primaryColumn = use(NativePrimaryColumnContext);
  const contentContainerStyle = {
    gap: 8,
    paddingTop: Platform.OS === "ios" ? 12 : 16,
    paddingBottom: props.bottom,
  };
  if (Platform.OS !== "ios") {
    return (
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        onLayout={onLayout}
        onScroll={onScroll}
        scrollEventThrottle={100}
        contentContainerStyle={contentContainerStyle}
      >
        <InboxViewportContext value={{ ...viewport, active: props.active }}>
          {props.children}
        </InboxViewportContext>
      </ScrollView>
    );
  }
  // Registered with its screen so UIKit can minimize the tab bar and fade the header on scroll.
  return (
    <NativeScrollViewMarker style={{ flex: 1 }}>
      <ScrollView
        className={primaryColumn ? "bg-drawer" : "bg-screen"}
        keyboardShouldPersistTaps="handled"
        onLayout={onLayout}
        onScroll={onScroll}
        scrollEventThrottle={100}
        keyboardDismissMode="interactive"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentInset={{ top: insets.top }}
        contentOffset={{ x: 0, y: -insets.top }}
        scrollIndicatorInsets={{ top: insets.top }}
        contentContainerStyle={contentContainerStyle}
      >
        <InboxViewportContext value={{ ...viewport, active: props.active }}>
          {props.children}
        </InboxViewportContext>
      </ScrollView>
    </NativeScrollViewMarker>
  );
}

function rowSelected(entry: BotInboxEntry, selectedThreadKey: string | null) {
  const thread = entry.previewThread ?? entry.bot.mainThread;
  return thread !== null && scopedThreadKey(thread.environmentId, thread.id) === selectedThreadKey;
}

/**
 * Bots as one conversation inbox across every connected environment: the Assistant first, then
 * each bot by its latest activity. A row is the bot's main conversation; its other threads stay
 * behind the Threads button in that conversation.
 */
export function BotsScreen() {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const insets = useSafeAreaInsets();
  const primaryColumn = use(NativePrimaryColumnContext);
  const projects = useBotProjects();
  // Streaming turns rewrite thread shells many times a second; skip that while a chat covers us.
  const visible = useHomeRouteVisible();
  const threads = useAtomValueWhileVisible(
    environmentThreadShells.navigationThreadShellsAtom,
    visible,
  );
  const environments = useWorkspaceEnvironments();
  const assistantEnvironmentId = useAssistantEnvironmentId();
  const query = useAtomValue(botsSearchQueryAtom);
  const unsentByThreadKey = useThreadOutboxMessages();
  // oxlint-disable-next-line t3code/react-effect-budget -- Clear the shared search state when the Bots room unmounts.
  useEffect(() => () => setBotsSearchQuery(null), []);
  const shown = useMemo(
    () =>
      environments
        .filter((environment) => environment.isEnabled)
        .sort((left, right) => left.environmentLabel.localeCompare(right.environmentLabel)),
    [environments],
  );
  const inbox = useMemo(
    () =>
      buildBotInbox({
        environments: shown.map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.environmentLabel,
          connected: environment.connectionState === "connected",
        })),
        projects,
        threads,
        assistantEnvironmentId,
        unsentByThreadKey,
        query: query ?? "",
      }),
    [shown, projects, threads, assistantEnvironmentId, unsentByThreadKey, query],
  );
  const bottom = Math.max(insets.bottom, workspace?.bottomClearance ?? 16) + 16;
  const selectedThreadKey = primaryColumn?.selectedThreadKey ?? null;

  if (shown.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-screen">
        <BotAvatar role="assistant" title="Assistant" size={64} />
        <EmptyState
          variant="plain"
          title="Talk to Assistant"
          detail="Add an environment that runs T3 Code and your Assistant appears here, with the same conversation on every device."
          actionLabel="Add environment"
          onAction={() => openSettings(navigation, "SettingsEnvironmentNew")}
        />
      </View>
    );
  }

  if (query === null && inbox.hero === null && inbox.rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-screen">
        <BotAvatar role="assistant" title="Assistant" size={64} />
        <EmptyState
          variant="plain"
          title="No bots yet"
          detail="Your Assistant appears here once an environment that supports bots is connected."
        />
      </View>
    );
  }

  return (
    <BotsScrollView bottom={bottom} active={visible}>
      {query !== null ? <BotsSearch query={query} /> : null}
      {inbox.hero ? (
        <InboxPlaybackFrame key={inbox.hero.bot.key}>
          <AssistantHero entry={inbox.hero} selected={rowSelected(inbox.hero, selectedThreadKey)} />
        </InboxPlaybackFrame>
      ) : null}
      {inbox.rows.map((entry) => (
        <InboxPlaybackFrame key={entry.bot.key}>
          <BotInboxRow entry={entry} selected={rowSelected(entry, selectedThreadKey)} />
        </InboxPlaybackFrame>
      ))}
      {query !== null && query.trim().length > 0 && inbox.rows.length === 0 ? (
        <Text textRole="footnote" className="px-5 py-6 text-center text-foreground-muted">
          No bot named “{query.trim()}”.
        </Text>
      ) : null}
    </BotsScrollView>
  );
}
