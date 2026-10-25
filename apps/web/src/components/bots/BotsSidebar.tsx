import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { MessageSquareIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import {
  useEnvironmentSupportsBotConversations,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { useEnvironmentConnectionSummaries } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import type { SidebarThreadSummary } from "../../types";
import { isSidebarSubagentThread, resolveThreadStatusPill } from "../Sidebar.logic";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  SidebarContent,
  SidebarGroup,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
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
import { useDesignatedAssistantEnvironmentId, useRouteBotProject } from "./useBotRoom";

type BotEntry = BotsCollectionEntry<EnvironmentProject>;

function StatusDot({ thread }: { thread: SidebarThreadSummary | null }) {
  const pill = thread ? resolveThreadStatusPill({ thread }) : null;
  if (pill === null) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center">
      <span aria-hidden className={cn("size-1.5 rounded-full", pill.dotClass)} />
      <span className="sr-only">{pill.label}</span>
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
}: {
  bot: EnvironmentProject;
  thread: SidebarThreadSummary;
  onOpen: () => void;
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
        isActive
        aria-current="page"
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
  const projects = useProjects();
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

  // A bot row is its main conversation. Its other threads stay in the chat header's Threads menu;
  // only the one on screen shows here, nested under its bot so the parent reads as context.
  const renderOpenThread = (bot: EnvironmentProject) => {
    if (routeBot?.id !== bot.id || routeBot.environmentId !== bot.environmentId) return null;
    const open = conversationsFor(bot).topics.find(
      (thread) => thread.id === routeThreadRef?.threadId,
    );
    if (open === undefined) return null;
    return (
      <SidebarMenuSub>
        <OpenBotThreadRow bot={bot} thread={open} onOpen={() => openBotThread(open)} />
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
    const { main } = conversationsFor(bot);
    const key = entryKey(entry);
    const note = entryNote(entry);
    return (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton
          isActive={isOnMain(entry, main)}
          // Offline, a bot opens only to a conversation this client still has.
          disabled={openingKey === key || (entry.offline && main === null)}
          aria-current={isOnMain(entry, main) ? "page" : undefined}
          onClick={() => void openBot(entry)}
        >
          <BotAvatar bot={bot} />
          <span className="min-w-0 flex-1 truncate">{bot.title}</span>
          {note !== null ? (
            <span className="max-w-24 shrink-0 truncate text-xs text-sidebar-muted-foreground">
              {note}
            </span>
          ) : null}
          {entry.offline ? null : <StatusDot thread={main} />}
        </SidebarMenuButton>
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
  const nothingListed =
    assistant === null && specialists.length === 0 && otherAssistants.length === 0;

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
                <SidebarMenuButton
                  size="lg"
                  isActive={isOnMain(assistant, assistantMain)}
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
                    size="md"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold text-sidebar-foreground">
                      {assistantProject?.title ?? "Assistant"}
                    </span>
                    <span className="truncate text-xs font-normal text-sidebar-muted-foreground">
                      {assistant.hostLabel === null
                        ? assistantStatus
                        : `${assistant.hostLabel} · ${assistantStatus}`}
                    </span>
                  </span>
                </SidebarMenuButton>
                {assistantProject ? renderOpenThread(assistantProject) : null}
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
          {specialists.length > 0 ? <Separator className="my-1.5" /> : null}
          <SidebarMenu aria-label="Specialists">{specialists.map(renderBot)}</SidebarMenu>
          {otherAssistants.length > 0 ? (
            <>
              <Separator className="my-1.5" />
              <p className="px-2 pt-1 pb-0.5 text-2xs font-medium text-sidebar-muted-foreground">
                Other Assistants
              </p>
              <SidebarMenu aria-label="Other Assistants">
                {otherAssistants.map(renderBot)}
              </SidebarMenu>
            </>
          ) : null}
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
