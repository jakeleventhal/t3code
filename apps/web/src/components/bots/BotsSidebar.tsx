import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useRelativeTimeState } from "../../hooks/useRelativeTimeState";
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
  useSidebar,
} from "../ui/sidebar";
import { BotAvatar } from "./BotAvatar";
import {
  botConversationActivityAt,
  botConversationPreview,
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
  className,
}: {
  thread: SidebarThreadSummary | null;
  related?: ReadonlyArray<SidebarThreadSummary>;
  offline?: boolean;
  className?: string;
}) {
  const pill = thread && !offline ? resolveThreadStatusPill({ thread }) : null;
  const conversations = thread ? [thread, ...related] : related;
  const needsAttention = conversations.some(
    (entry) => entry.hasPendingApprovals || entry.hasPendingUserInput,
  );
  const unread = conversations.some(hasUnseenCompletion);
  if (pill === null && !needsAttention && !unread) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {needsAttention ? (
        <CircleAlertIcon className="size-3.5 text-warning" aria-label="Needs attention" />
      ) : null}
      {unread ? (
        <span
          className="size-2 shrink-0 rounded-full bg-info"
          role="img"
          aria-label="Unread reply"
        />
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
  const parts = [entry.offline ? "Offline" : null, entry.hostLabel].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Compact "5m" beside a row, ticking only when the label would change. */
function RowTime({ at, className }: { at: string | null; className?: string }) {
  const relative = useRelativeTimeState(at);
  if (relative.status !== "relative") return null;
  return (
    <span className={cn("shrink-0 text-2xs font-normal tabular-nums", className)}>
      {relative.value === "just now" ? "now" : relative.value}
    </span>
  );
}

/** A bot's avatar, dimmed with a grey status mark while its environment is away. */
function RowAvatar({
  bot,
  size,
  offline,
}: {
  bot: Parameters<typeof BotAvatar>[0]["bot"];
  size: "row" | "hero";
  offline: boolean;
}) {
  return (
    <span className="relative shrink-0">
      <BotAvatar bot={bot} size={size} className={cn(offline && "opacity-55")} />
      {offline ? (
        <span
          aria-hidden
          className="absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-muted-foreground"
        />
      ) : null}
    </span>
  );
}

/**
 * One conversation under its bot. The whole row is the hit target; a hairline ties it to the bot
 * above and turns into a short accent rule on the open conversation.
 */
function conversationRowClassName(active: boolean, unread: boolean) {
  return cn(
    "relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg ps-10 pe-2.5 text-start text-xs text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    "before:absolute before:inset-y-0 before:start-6 before:w-px before:bg-sidebar-border",
    active &&
      "bg-sidebar-row-selected before:inset-y-2 before:start-[1.4375rem] before:w-0.5 before:rounded-full before:bg-primary",
    unread && "font-semibold",
  );
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
      <li className="ps-8">
        <BotThreadRenameInput target={target} actions={actions} onDone={() => setRenaming(false)} />
      </li>
    );
  }
  return (
    <li
      onContextMenu={(event) => {
        if (!canOperate) return;
        event.preventDefault();
        void actions.openMenu(target, { x: event.clientX, y: event.clientY }, () =>
          setRenaming(true),
        );
      }}
    >
      <button
        type="button"
        className={conversationRowClassName(active, hasUnseenCompletion(thread))}
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
      >
        <MessageSquareIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <StatusDot thread={thread} />
        <RowTime at={botConversationActivityAt(thread)} className="text-sidebar-muted-foreground" />
      </button>
    </li>
  );
}

/** Starts a topic with this bot, the same conversational draft its Threads menu opens. */
function NewConversationRow({ bot }: { bot: EnvironmentProject }) {
  const canOperate = useEnvironmentScope(bot.environmentId, AuthOrchestrationOperateScope);
  const handleNewThread = useNewThreadHandler();
  if (!canOperate) return null;
  return (
    <li>
      <button
        type="button"
        className={cn(
          conversationRowClassName(false, false),
          "text-sidebar-muted-foreground hover:text-sidebar-foreground",
        )}
        onClick={() => void handleNewThread(scopeProjectRef(bot.environmentId, bot.id))}
      >
        <PlusIcon className="size-3.5 shrink-0" />
        <span className="truncate">New conversation</span>
      </button>
    </li>
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
    const mainActive = main?.id === routeThreadRef?.threadId;
    return (
      <ul aria-label={`${bot.title} conversations`} className="flex flex-col gap-px pt-0.5 pb-1.5">
        {main ? (
          <li>
            <button
              type="button"
              className={conversationRowClassName(mainActive, hasUnseenCompletion(main))}
              aria-current={mainActive ? "page" : undefined}
              onClick={() => openBotThread(main)}
            >
              <MessageSquareIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Main conversation</span>
              <StatusDot thread={main} />
              <RowTime
                at={botConversationActivityAt(main)}
                className="text-sidebar-muted-foreground"
              />
            </button>
          </li>
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
        <NewConversationRow bot={bot} />
      </ul>
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
    const unread = [...(main ? [main] : []), ...topics].some(hasUnseenCompletion);
    const preview =
      botConversationPreview(main) ||
      (main && hasUnseenCompletion(main)
        ? "New reply"
        : main?.latestRun?.status === "completed"
          ? "Replied"
          : "No messages yet");
    const expanded =
      topics.length > 0 && routeBot?.id === bot.id && routeBot.environmentId === bot.environmentId;
    return (
      <SidebarMenuItem key={key}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
            isOnMain(entry, main) && "bg-sidebar-row-selected",
          )}
          disabled={openingKey === key || (entry.offline && main === null)}
          aria-current={isOnMain(entry, main) ? "page" : undefined}
          aria-expanded={topics.length > 0 ? expanded : undefined}
          onClick={() => void openBot(entry)}
        >
          <RowAvatar bot={bot} size="row" offline={entry.offline} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm text-sidebar-foreground",
                  unread ? "font-bold" : "font-semibold",
                )}
              >
                {bot.title}
              </span>
              <RowTime
                at={botConversationActivityAt(main)}
                className="text-sidebar-muted-foreground"
              />
            </span>
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                unread ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {note ? `${note} · ${preview}` : preview}
              </span>
              <StatusDot thread={main} related={topics} offline={entry.offline} />
              {topics.length > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
                    expanded && "rotate-90",
                  )}
                />
              ) : null}
            </span>
          </span>
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
                    "my-0.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                    isOnMain(assistant, assistantMain) && "bg-sidebar-row-selected",
                  )}
                  disabled={assistantUnavailable || openingKey === assistantKey}
                  aria-current={isOnMain(assistant, assistantMain) ? "page" : undefined}
                  onClick={() => void openBot(assistant)}
                >
                  <RowAvatar
                    bot={
                      assistantProject ?? {
                        id: "assistant",
                        title: "Assistant",
                        botRole: "assistant",
                      }
                    }
                    size="hero"
                    offline={assistant.offline}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
                        {assistantProject?.title ?? "Assistant"}
                      </span>
                      <StatusDot
                        thread={assistantMain}
                        related={assistantProject ? conversationsFor(assistantProject).topics : []}
                        offline={assistant.offline}
                      />
                      <RowTime
                        at={botConversationActivityAt(assistantMain)}
                        className="ms-auto text-sidebar-muted-foreground"
                      />
                    </span>
                    <span className="truncate text-xs text-sidebar-muted-foreground">
                      {assistant.offline || assistantProject === null || openingKey === assistantKey
                        ? assistantStatus
                        : (botConversationPreview(assistantMain) ?? assistantStatus)}
                    </span>
                  </span>
                </button>
                {assistantProject ? renderOpenThread(assistantProject) : null}
                {routeBot?.botRole === "assistant" && otherAssistants.length > 0 ? (
                  <ul
                    aria-label="Earlier Assistant conversations"
                    className="flex flex-col gap-px pb-1.5"
                  >
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
                  </ul>
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
              No bot named “{query.trim()}”.
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
