import { botPreviewText } from "@t3tools/shared/botPreview";
import { useAssistantEnvironmentId } from "./use-assistant";
import { environmentAssistant } from "@t3tools/client-runtime/assistant-environment";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Button } from "../../components/ui/Button";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useBotConversationCall } from "./use-bot-call";
import { openSettings } from "../settings/settings-navigation";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { ListSection } from "../../components/ui/ListSection";
import { Menu } from "../../components/ui/Menu";
import { RowPressable } from "../../components/ui/RowPressable";
import { SearchField } from "../../components/ui/SearchField";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { uuidv4 } from "../../lib/uuid";
import { useProject, useProjects } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadShells } from "../../state/threads";
import { useArchivedThreadSnapshots } from "../archive/useArchivedThreadSnapshots";
import { useArchivedThreadListActions, useThreadListActions } from "../home/useThreadListActions";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { botThreadStatus, buildBotThreadList } from "./bot-room";
import { useShowConversationInBots } from "./use-assistant";
import { useBotAvailability } from "./use-bot-conversation";
import { BotAvatar } from "./BotAvatar";
import { threadHasUnseenCompletion } from "../threads/threadListV2";

type ThreadMenuAction = "rename" | "archive" | "reopen";

/** The newest visible line, else what the thread is doing or when it last moved. */
function threadPreview(thread: EnvironmentThreadShell): string {
  const status = botThreadStatus(thread);
  if (status !== null) return threadSubtitle(thread);
  return botPreviewText(thread.source.latestVisibleMessage?.text) || threadSubtitle(thread);
}

function threadTime(thread: EnvironmentThreadShell): string | null {
  const age = relativeTime(thread.updatedAt);
  return age === "<1m" ? "now" : age;
}

function threadSubtitle(thread: EnvironmentThreadShell): string {
  const status = botThreadStatus(thread);
  if (status === "needs-you") return "Needs you";
  if (status === "working") return "Working…";
  const age = relativeTime(thread.archivedAt ?? thread.updatedAt);
  return age === "<1m" ? "Just now" : `${age} ago`;
}

function ThreadRow(props: {
  readonly icon: AppSymbolName;
  readonly title: string;
  readonly subtitle: string;
  readonly time?: string | null;
  readonly unread?: boolean;
  readonly current: boolean;
  readonly attention?: boolean;
  readonly divider: boolean;
  readonly menu?: ReadonlyArray<{
    readonly id: ThreadMenuAction;
    readonly title: string;
    readonly disabled: boolean;
  }>;
  readonly onMenuAction?: (action: ThreadMenuAction) => void;
  readonly onPress: () => void;
}) {
  const actions =
    props.menu?.map((item) => ({
      id: item.id,
      title: item.title,
      attributes: { disabled: item.disabled },
    })) ?? [];
  const onAction = (id: string) => {
    const action = props.menu?.find((item) => item.id === id);
    if (action && !action.disabled) props.onMenuAction?.(action.id);
  };
  const content = (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={[props.title, props.unread ? "New reply" : null, props.subtitle]
        .filter((part) => part !== null)
        .join(", ")}
      accessibilityState={{ selected: props.current }}
      onPress={props.onPress}
      className="flex-1"
    >
      <View className="min-h-[60px] flex-row items-center gap-3 py-2.5 pl-4 pr-2">
        <SymbolView name={props.icon} size={16} tintColorClassName="accent-icon-muted" />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <Text
              className={cn(
                "min-w-0 flex-1 text-foreground",
                props.unread && "font-t3-semibold",
                props.current && "text-thread-selected-foreground",
              )}
              numberOfLines={1}
            >
              {props.title}
            </Text>
            {props.time ? (
              <Text
                textRole="label"
                className={props.unread ? "text-primary-text" : "text-foreground-tertiary"}
              >
                {props.time}
              </Text>
            ) : null}
          </View>
          <View className="flex-row items-center gap-2">
            <Text
              textRole="footnote"
              className={cn(
                "min-w-0 flex-1",
                props.attention ? "text-warning-foreground" : "text-foreground-muted",
              )}
              numberOfLines={1}
            >
              {props.subtitle}
            </Text>
            {props.unread ? <View className="size-2.5 rounded-full bg-blue-500" /> : null}
          </View>
        </View>
        {props.current ? (
          <SymbolView name="checkmark" size={14} tintColorClassName="accent-icon-muted" />
        ) : null}
      </View>
    </RowPressable>
  );
  return (
    <View className={props.current ? "bg-thread-selected" : "bg-grouped-card"}>
      <View className="flex-row items-center pr-2">
        {props.menu ? (
          <Menu
            actions={actions}
            onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
            shouldOpenOnLongPress
            style={{ flex: 1 }}
          >
            {content}
          </Menu>
        ) : (
          content
        )}
        {props.menu ? (
          <Menu actions={actions} onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}>
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Actions for ${props.title}`}
              className="size-12 items-center justify-center"
            >
              <SymbolView name="ellipsis" size={22} tintColorClassName="accent-icon-muted" />
            </View>
          </Menu>
        ) : null}
      </View>
      {props.divider ? <View className="ml-11 h-px bg-border-subtle" /> : null}
    </View>
  );
}

function ActionRow(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly expanded?: boolean;
  readonly primary?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.expanded === undefined ? undefined : { expanded: props.expanded }}
      onPress={props.onPress}
      className="bg-grouped-card"
    >
      <View className="min-h-12 flex-row items-center gap-3 py-3 pl-4 pr-4">
        <SymbolView
          name={props.icon}
          size={16}
          tintColorClassName={props.primary ? "accent-primary-text" : "accent-icon-muted"}
        />
        <Text
          textRole={props.primary ? "body" : "footnote"}
          className={cn(
            "min-w-0 flex-1",
            props.primary ? "text-primary-text" : "text-foreground-muted",
          )}
        >
          {props.label}
        </Text>
      </View>
    </RowPressable>
  );
}

/**
 * Archived threads come from the archive snapshot, so it loads only while this section is open.
 * Opening one reads it where it is; only Reopen brings it back to the bot's threads.
 */
function ArchivedThreads(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly query: string;
  readonly currentThreadId: string | null;
  readonly canOperate: boolean;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
  readonly onRename: (thread: EnvironmentThreadShell) => void;
}) {
  const [environmentIds] = useState(() => [props.project.environmentId]);
  const { snapshots, error, isLoading, refresh } = useArchivedThreadSnapshots(environmentIds);
  // oxlint-disable-next-line t3code/react-effect-budget -- Fetch archived remote snapshots when the archive view mounts.
  useEffect(() => {
    refresh();
  }, [refresh]);
  const { unarchiveThread } = useArchivedThreadListActions(() => undefined);
  const archived = snapshots.flatMap((entry) =>
    entry.snapshot.threads.map((thread) => scopeThreadShell(entry.environmentId, thread)),
  );
  const list = buildBotThreadList({
    project: props.project,
    threads: props.threads,
    archived,
    query: props.query,
  });
  if (list.archived.length === 0) {
    return (
      <View className="items-center px-6 py-4">
        {isLoading ? (
          <AppActivityIndicator size="small" />
        ) : (
          <Text textRole="footnote" className="text-center text-foreground-muted">
            {error ??
              (props.query.trim().length > 0
                ? "No archived threads match."
                : "No archived threads.")}
          </Text>
        )}
      </View>
    );
  }
  return (
    <ListSection>
      {list.archived.map((thread, index) => (
        <ThreadRow
          key={thread.id}
          icon="archivebox"
          title={thread.title}
          subtitle={`Archived ${threadSubtitle(thread)}`}
          current={thread.id === props.currentThreadId}
          divider={index < list.archived.length - 1}
          menu={[
            { id: "reopen", title: "Reopen", disabled: !props.canOperate },
            { id: "rename", title: "Rename", disabled: !props.canOperate },
          ]}
          onMenuAction={(action) => {
            if (action === "reopen") unarchiveThread(thread);
            else props.onRename(thread);
          }}
          onPress={() => props.onOpen(thread)}
        />
      ))}
    </ListSection>
  );
}

/**
 * A bot's threads, tucked behind its chat: the ongoing main conversation first, then the threads
 * opened beside it for parallel work, and the archived ones on request.
 */
export function BotThreadsSheet(
  props: StaticScreenProps<{
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId?: string;
  }>,
) {
  const routeEnvironmentId = EnvironmentId.make(props.route.params.environmentId);
  const routeProjectId = ProjectId.make(props.route.params.projectId);
  const currentThreadId = props.route.params.threadId ?? null;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const routeProject = useProject({ environmentId: routeEnvironmentId, projectId: routeProjectId });
  const projects = useProjects();
  const assistant = environmentAssistant(projects, useAssistantEnvironmentId());
  const project =
    routeProject?.botRole === "assistant" ? (assistant ?? routeProject) : routeProject;
  const environmentId = project?.environmentId ?? routeEnvironmentId;
  const projectId = project?.id ?? routeProjectId;
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canStart = useBotAvailability(environmentId).canStart;
  const { archiveThread, renameThread } = useThreadListActions();
  const showConversation = useShowConversationInBots();
  const selectRoom = useWorkspaceTabs()?.selectRoom;
  const selectDetail = useSelectWorkspaceDetail();
  const searchRef = useRef<TextInputInstance | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };
  const open = (threadId: ThreadId) => showConversation({ environmentId, threadId });

  const connected = useWorkspaceEnvironments().some(
    (entry) => entry.environmentId === environmentId && entry.connectionState === "connected",
  );
  const onCall = useBotConversationCall({
    thread: project?.botMainThreadId ? { environmentId, threadId: project.botMainThreadId } : null,
    project,
    connected,
    onOpenSettings: () =>
      openSettings(navigation, "SettingsVoiceBot", { environmentId, projectId }),
  });
  const header = (
    <View
      className="flex-row items-center justify-between px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <IconButton accessibilityLabel="Back" icon="chevron.left" onPress={close} />
      {onCall ? (
        <IconButton
          accessibilityLabel={`Call ${project?.title ?? "bot"}`}
          icon="phone"
          onPress={onCall}
        />
      ) : null}
    </View>
  );

  const earlierProjectKeys = new Set(
    projects
      .filter(
        (owner) =>
          owner.botRole === "assistant" &&
          (owner.id !== projectId || owner.environmentId !== environmentId),
      )
      .map((owner) => `${owner.environmentId}:${owner.id}`),
  );
  const earlierConversations =
    project?.botRole === "assistant"
      ? threads.filter(
          (thread) =>
            thread.archivedAt === null &&
            earlierProjectKeys.has(`${thread.environmentId}:${thread.projectId}`) &&
            thread.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
      : [];
  if (project === null) {
    return (
      <View className="flex-1 bg-sheet">
        {header}
        <Text textRole="footnote" className="px-6 py-8 text-center text-foreground-muted">
          This bot isn’t on this device anymore.
        </Text>
      </View>
    );
  }

  const list = buildBotThreadList({ project, threads, archived: [], query });
  const mainThreadId = project.botMainThreadId ?? null;
  const archive = async (thread: EnvironmentThreadShell) => {
    const archived = await archiveThread(thread);
    // The archived thread leaves the chat for the bot's ongoing conversation.
    if (archived && thread.id === currentThreadId && mainThreadId !== null) open(mainThreadId);
  };
  const startThread = () => {
    const draft = {
      requestId: uuidv4(),
      environmentId: String(environmentId),
      projectId: String(projectId),
      title: project.title,
    };
    if (selectRoom) selectRoom("bots", { name: "Thread", params: { draft } });
    else selectDetail({ name: "Thread", params: { draft } });
  };

  return (
    <View className="flex-1 bg-sheet">
      {header}
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerClassName="gap-4 px-4"
        contentContainerStyle={{
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
        }}
      >
        <View className="items-center gap-3 pb-4">
          <BotAvatar
            role={project.botRole === "assistant" ? "assistant" : "specialist"}
            title={project.title}
            size={96}
            project={project}
          />
          <Text className="text-2xl font-t3-bold text-foreground">{project.title}</Text>
          <Text textRole="footnote" className="text-foreground-muted">
            {project.botRole === "assistant" ? "Your assistant" : "Specialist"}
            {connected ? "" : " · Offline"}
          </Text>
          <View className="flex-row gap-2">
            {mainThreadId ? (
              <Button label="Message" icon="bubble.left" onPress={() => open(mainThreadId)} />
            ) : null}
            <Button
              label="Profile"
              icon="person.crop.circle"
              onPress={() => navigation.navigate("BotProfile", { environmentId, projectId })}
            />
          </View>
        </View>
        <Text textRole="headline" className="text-foreground">
          Conversations
        </Text>
        <View className="flex-row">
          <SearchField
            autoFocus={false}
            inputRef={searchRef}
            accessibilityLabel="Search conversations"
            clearAccessibilityLabel="Clear search"
            placeholder="Search conversations"
            value={query}
            onChangeText={setQuery}
          />
        </View>
        <ListSection>
          {mainThreadId !== null ? (
            <ThreadRow
              icon="bubble.left"
              title="Main conversation"
              subtitle={list.main ? threadPreview(list.main) : "Reopen conversation"}
              time={list.main ? threadTime(list.main) : null}
              unread={list.main !== null && threadHasUnseenCompletion(list.main)}
              current={currentThreadId === mainThreadId}
              attention={list.main !== null && botThreadStatus(list.main) === "needs-you"}
              divider={list.active.length > 0 || canStart}
              onPress={() => open(mainThreadId)}
            />
          ) : null}
          {list.active.map((thread) => (
            <ThreadRow
              key={thread.id}
              icon="text.bubble"
              title={thread.title}
              subtitle={threadPreview(thread)}
              time={threadTime(thread)}
              unread={threadHasUnseenCompletion(thread)}
              current={thread.id === currentThreadId}
              attention={botThreadStatus(thread) === "needs-you"}
              divider
              menu={[
                { id: "rename", title: "Rename", disabled: !canOperate },
                { id: "archive", title: "Archive", disabled: !canOperate },
              ]}
              onMenuAction={(action) => {
                if (action === "rename") renameThread(thread);
                else void archive(thread);
              }}
              onPress={() => open(thread.id)}
            />
          ))}
          {canStart ? (
            <ActionRow icon="plus" label="New conversation" primary onPress={startThread} />
          ) : null}
        </ListSection>
        {earlierConversations.length > 0 ? (
          <ListSection>
            {earlierConversations.map((thread) => (
              <ThreadRow
                key={`${thread.environmentId}:${thread.id}`}
                icon="text.bubble"
                title={thread.title}
                subtitle="Earlier conversation"
                current={
                  thread.id === currentThreadId && thread.environmentId === routeEnvironmentId
                }
                divider
                onPress={() =>
                  showConversation({ environmentId: thread.environmentId, threadId: thread.id })
                }
              />
            ))}
          </ListSection>
        ) : null}
        {list.active.length === 0 &&
        earlierConversations.length === 0 &&
        query.trim().length > 0 ? (
          <Text textRole="footnote" className="px-2 text-center text-foreground-muted">
            No conversations match.
          </Text>
        ) : null}
        <ListSection>
          <ActionRow
            icon={showArchived ? "chevron.down" : "chevron.right"}
            label="Show archived"
            expanded={showArchived}
            onPress={() => setShowArchived((current) => !current)}
          />
        </ListSection>
        {showArchived ? (
          <ArchivedThreads
            project={project}
            threads={threads}
            query={query}
            currentThreadId={currentThreadId}
            canOperate={canOperate}
            onOpen={(thread) => open(thread.id)}
            onRename={renameThread}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
