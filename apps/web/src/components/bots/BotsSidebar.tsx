import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentSupportsBotConversations, useThreadShells } from "../../state/entities";
import { useEnvironmentConnectionSummaries } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import type { SidebarThreadSummary } from "../../types";
import {
  hasUnseenCompletion,
  isSidebarSubagentThread,
  resolveThreadStatusPill,
} from "../Sidebar.logic";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  SidebarContent,
  SidebarGroup,
  SidebarInput,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar";
import { BotAvatar } from "./BotAvatar";
import {
  botProjectKeys,
  buildBotsCollection,
  orderBotConversations,
  type BotsCollectionEntry,
} from "./botRoom.logic";
import { BotThreadRenameInput } from "./BotThreadsMenu";
import { NewBotDialog, useNewBotHost } from "./NewBotDialog";
import { SidebarRoomSwitch } from "./SidebarRoomSwitch";
import { useBotActions } from "./useBotActions";
import { useBotThreadActions } from "./useBotThreadActions";
import {
  useDesignatedAssistantEnvironmentId,
  useRouteBotProject,
  useBotProjects,
} from "./useBotRoom";

type BotEntry = BotsCollectionEntry<EnvironmentProject>;
const EMPTY_RELATED_THREADS: ReadonlyArray<SidebarThreadSummary> = [];

function StatusDot({
  thread,
  related = EMPTY_RELATED_THREADS,
  offline = false,
}: {
  thread: SidebarThreadSummary | null;
  related?: ReadonlyArray<SidebarThreadSummary>;
  offline?: boolean;
}) {
  const pill = thread && !offline ? resolveThreadStatusPill({ thread }) : null;
  const conversations = thread ? [thread, ...related] : related;
  const needsAttention = conversations.some(
    (entry) => entry.hasPendingApprovals || entry.hasPendingUserInput,
  );
  const unread = conversations.some(hasUnseenCompletion);
  if (pill === null && !needsAttention && !unread) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {needsAttention ? (
        <CircleAlertIcon className="size-4 text-warning" aria-label="Needs attention" />
      ) : null}
      {unread ? (
        <MessageSquareIcon className="size-3.5 text-primary" aria-label="Unread reply" />
      ) : null}
      {!needsAttention && !unread && pill ? (
        <span aria-hidden className={cn("size-1.5 rounded-full", pill.dotClass)} />
      ) : null}
      <span className="sr-only">{pill?.label}</span>
    </span>
  );
}

/** Host and availability, only when they tell this bot apart or explain why it can't answer. */
function entryNote(entry: BotEntry): string | null {
  const parts = [entry.hostLabel, entry.offline ? "Offline" : null].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join(" · ");
}

function entryKey(entry: BotEntry): string {
  return `${entry.environmentId}:${entry.project?.id ?? "assistant"}`;
}

/** New bots go to the default host set on the designated Assistant's environment. */
function NewBotButton({
  sourceEnvironmentId,
  onCreated,
}: {
  sourceEnvironmentId: EnvironmentId;
  onCreated: () => void;
}) {
  const host = useNewBotHost(sourceEnvironmentId);
  const canCreate = useAtomValue(botEnvironment.create.permissionAtom(host.environmentId));
  const [open, setOpen] = useState(false);
  // An unavailable host keeps the button so the dialog can say why; a connection that simply
  // can't create bots there has nothing to offer.
  if (host.kind === "ready" && !canCreate) return null;
  return (
    <>
      <SidebarHeaderIconButton label="New bot" onClick={() => setOpen(true)}>
        <PlusIcon />
      </SidebarHeaderIconButton>
      <NewBotDialog
        key={sourceEnvironmentId}
        environmentId={sourceEnvironmentId}
        open={open}
        onOpenChange={setOpen}
        onCreated={onCreated}
      />
    </>
  );
}

function OpenBotThreadRow({
  bot,
  thread,
  onOpen,
  active,
}: {
  bot: EnvironmentProject;
  thread: SidebarThreadSummary;
  onOpen: () => void;
  active: boolean;
}) {
  const actions = useBotThreadActions(bot);
  const canOperate = useEnvironmentScope(bot.environmentId, AuthOrchestrationOperateScope);
  const [renaming, setRenaming] = useState(false);
  const target = {
    ref: scopeThreadRef(thread.environmentId, thread.id),
    title: thread.title,
    archived: false,
  };
  if (renaming) {
    return (
      <SidebarMenuSubItem>
        <BotThreadRenameInput target={target} actions={actions} onDone={() => setRenaming(false)} />
      </SidebarMenuSubItem>
    );
  }
  return (
    <SidebarMenuSubItem
      onContextMenu={(event) => {
        if (!canOperate) return;
        event.preventDefault();
        void actions.openMenu(target, { x: event.clientX, y: event.clientY }, () =>
          setRenaming(true),
        );
      }}
    >
      <SidebarMenuSubButton
        render={<button type="button" />}
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
      >
        <MessageSquareIcon />
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <StatusDot thread={thread} />
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

export default function BotsSidebar() {
  const assistantEnvironmentId = useDesignatedAssistantEnvironmentId();
  const environments = useEnvironmentConnectionSummaries();
  const projects = useBotProjects();
  const threads = useThreadShells();
  const routeThreadRef = useThreadRouteRef();
  const routeBot = useRouteBotProject();
  const { isMobile, setOpenMobile } = useSidebar();
  const { openMainConversation, openThread } = useBotActions();
  const canOperate = useEnvironmentScope(assistantEnvironmentId, AuthOrchestrationOperateScope);
  const supported = useEnvironmentSupportsBotConversations(assistantEnvironmentId);
  const [query, setQuery] = useState("");
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const { assistant, specialists, otherAssistants } = buildBotsCollection({
    projects,
    environments: environments
      .filter((environment) => environment.isEnabled)
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.environmentLabel,
        connected: environment.connectionState === "connected",
      })),
    assistantEnvironmentId,
    query,
  });
  const botKeys = botProjectKeys(projects);
  const threadsByBot = new Map<string, (typeof threads)[number][]>();
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    if (!(botKeys?.has(key) ?? false) || isSidebarSubagentThread(thread)) continue;
    const owned = threadsByBot.get(key);
    if (owned) owned.push(thread);
    else threadsByBot.set(key, [thread]);
  }
  const conversationsFor = (bot: EnvironmentProject) =>
    orderBotConversations(
      threadsByBot.get(`${bot.environmentId}:${bot.id}`) ?? [],
      bot.botMainThreadId,
    );

  const closeMobileSheet = () => {
    if (isMobile) setOpenMobile(false);
  };
  // Each bot opens on its own environment, with that environment's permissions.
  const openBot = async (entry: BotEntry) => {
    if (openingKey !== null) return;
    const key = entryKey(entry);
    setOpeningKey(key);
    const opened = await openMainConversation(entry.environmentId, entry.project);
    setOpeningKey((current) => (current === key ? null : current));
    if (opened) closeMobileSheet();
  };
  const openBotThread = (thread: SidebarThreadSummary) => {
    closeMobileSheet();
    void openThread(scopeThreadRef(thread.environmentId, thread.id));
  };

  const renderOpenThread = (bot: EnvironmentProject) => {
    if (routeBot?.id !== bot.id || routeBot.environmentId !== bot.environmentId) return null;
    const { main, topics } = conversationsFor(bot);
    if (topics.length === 0) return null;
    return (
      <SidebarMenuSub>
        {main ? (
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              render={<button type="button" />}
              isActive={main.id === routeThreadRef?.threadId}
              onClick={() => openBotThread(main)}
            >
              <MessageSquareIcon />
              <span>Main conversation</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ) : null}
        {topics.map((thread) => (
          <OpenBotThreadRow
            key={thread.id}
            bot={bot}
            thread={thread}
            active={thread.id === routeThreadRef?.threadId}
            onOpen={() => openBotThread(thread)}
          />
        ))}
      </SidebarMenuSub>
    );
  };
  const isOnMain = (entry: BotEntry, main: SidebarThreadSummary | null) =>
    main !== null &&
    routeThreadRef?.environmentId === entry.environmentId &&
    routeThreadRef.threadId === main.id;

  const renderBot = (entry: BotEntry) => {
    const bot = entry.project;
    if (bot === null) return null;
    const { main, topics } = conversationsFor(bot);
    const key = entryKey(entry);
    const note = entryNote(entry);
    const preview =
      main?.source.latestVisibleMessage?.text.replace(/\s+/g, " ").trim() ||
      (main && hasUnseenCompletion(main)
        ? "New reply"
        : main?.latestRun?.status === "completed"
          ? "Replied"
          : "No messages yet");
    return (
      <SidebarMenuItem key={key}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
            isOnMain(entry, main) && "bg-sidebar-row-selected",
          )}
          disabled={openingKey === key || (entry.offline && main === null)}
          aria-current={isOnMain(entry, main) ? "page" : undefined}
          onClick={() => void openBot(entry)}
        >
          <BotAvatar bot={bot} size="list" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-sidebar-foreground">
              {bot.title}
            </span>
            <span className="block truncate text-sm text-sidebar-muted-foreground">
              {note ?? preview}
            </span>
          </span>
          <StatusDot thread={main} related={topics} offline={entry.offline} />
          {topics.length > 0 ? (
            <ChevronDownIcon className="size-4 text-sidebar-muted-foreground" />
          ) : null}
        </button>
        {renderOpenThread(bot)}
      </SidebarMenuItem>
    );
  };

  const assistantProject = assistant?.project ?? null;
  const assistantMain = assistantProject ? conversationsFor(assistantProject).main : null;
  const assistantPill =
    assistantMain && !assistant?.offline
      ? resolveThreadStatusPill({ thread: assistantMain })
      : null;
  const assistantKey = assistant ? entryKey(assistant) : null;
  // Before Assistant exists, opening it creates it, which needs a writable connection to a server
  // that supports bots.
  const canProvision = canOperate && supported;
  const assistantStatus =
    assistant === null
      ? null
      : openingKey === assistantKey
        ? "Opening…"
        : assistant.offline
          ? "Offline"
          : (assistantPill?.label ??
            (assistantProject === null
              ? canProvision
                ? "Start a conversation"
                : supported
                  ? "This connection can’t start it"
                  : "Needs a newer server"
              : "Ongoing conversation"));
  const assistantUnavailable =
    assistant === null ||
    (assistantProject === null && (!canProvision || assistant.offline)) ||
    (assistant.offline && assistantMain === null);
  const nothingListed = assistant === null && specialists.length === 0;

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex flex-col gap-2">
              <SidebarRoomSwitch room="bots" />
              <div className="flex items-center gap-1">
                <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
                  <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
                  <SidebarInput
                    nativeInput
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search bots"
                    aria-label="Search bots"
                    className="min-w-0 flex-1"
                  />
                  {query.length > 0 ? (
                    <Button
                      type="button"
                      size="icon-micro"
                      variant="ghost-muted"
                      className="shrink-0"
                      aria-label="Clear bot search"
                      onClick={() => setQuery("")}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  ) : null}
                </div>
                {assistantEnvironmentId !== null ? (
                  <NewBotButton
                    sourceEnvironmentId={assistantEnvironmentId}
                    onCreated={closeMobileSheet}
                  />
                ) : null}
              </div>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          <SidebarMenu aria-label="Bots">
            {assistant !== null ? (
              <SidebarMenuItem>
                <button
                  type="button"
                  className={cn(
                    "mx-auto flex w-full flex-col items-center gap-3 rounded-2xl px-4 py-5 text-center hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                    isOnMain(assistant, assistantMain) && "bg-sidebar-row-selected",
                  )}
                  disabled={assistantUnavailable || openingKey === assistantKey}
                  aria-current={isOnMain(assistant, assistantMain) ? "page" : undefined}
                  onClick={() => void openBot(assistant)}
                >
                  <BotAvatar
                    bot={
                      assistantProject ?? {
                        id: "assistant",
                        title: "Assistant",
                        botRole: "assistant",
                      }
                    }
                    size="xl"
                  />
                  <span className="flex items-center gap-2 text-lg font-semibold text-sidebar-foreground">
                    {assistantProject?.title ?? "Assistant"}
                    <StatusDot
                      thread={assistantMain}
                      related={assistantProject ? conversationsFor(assistantProject).topics : []}
                      offline={assistant.offline}
                    />
                  </span>
                  {assistant.offline || assistantProject === null || openingKey === assistantKey ? (
                    <span className="text-sm text-sidebar-muted-foreground">{assistantStatus}</span>
                  ) : null}
                </button>
                {assistantProject ? renderOpenThread(assistantProject) : null}
                {routeBot?.botRole === "assistant" && otherAssistants.length > 0 ? (
                  <SidebarMenuSub aria-label="Earlier Assistant conversations">
                    {otherAssistants.flatMap((entry) => {
                      if (!entry.project) return [];
                      const { main, topics } = conversationsFor(entry.project);
                      return [...(main ? [main] : []), ...topics].map((thread) => (
                        <OpenBotThreadRow
                          key={`${thread.environmentId}:${thread.id}`}
                          bot={entry.project!}
                          thread={thread}
                          active={
                            thread.environmentId === routeThreadRef?.environmentId &&
                            thread.id === routeThreadRef.threadId
                          }
                          onOpen={() => openBotThread(thread)}
                        />
                      ));
                    })}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
          {specialists.length > 0 ? <Separator className="my-1.5" /> : null}
          <SidebarMenu aria-label="Specialists">{specialists.map(renderBot)}</SidebarMenu>
          {query.trim().length > 0 && nothingListed ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
            >
              No bots found
            </p>
          ) : null}
          {query.trim().length === 0 && nothingListed ? (
            <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
              Connect an environment to use bots.
            </p>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
