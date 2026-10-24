import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { MessageSquareIcon, PinIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import {
  useEnvironmentSupportsBotConversations,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import type { SidebarThreadSummary } from "../../types";
import { isSidebarSubagentThread, resolveThreadStatusPill } from "../Sidebar.logic";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
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
import { orderBotConversations, partitionEnvironmentBots } from "./botRoom.logic";
import { NewBotDialog } from "./NewBotDialog";
import { SidebarRoomSwitch, useEnterBotsRoom } from "./SidebarRoomSwitch";
import { useBotActions } from "./useBotActions";
import { useBotsEnvironmentId, useRouteBotProject } from "./useBotRoom";

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

function EnvironmentPicker({ environmentId }: { environmentId: EnvironmentId | null }) {
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const identities = useEnvironmentIdentities();
  const enterBotsRoom = useEnterBotsRoom();
  if (connectedEnvironmentIds.length < 2) return null;
  const items = connectedEnvironmentIds.map((id) => ({
    value: id,
    label: identities.find((identity) => identity.environmentId === id)?.label ?? id,
  }));
  return (
    <Select
      value={environmentId}
      items={items}
      onValueChange={(value) => {
        const next = connectedEnvironmentIds.find((id) => id === value);
        if (next !== undefined && next !== environmentId) enterBotsRoom(next);
      }}
    >
      <SelectTrigger size="sm" aria-label="Bots environment">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export default function BotsSidebar() {
  const environmentId = useBotsEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const routeThreadRef = useThreadRouteRef();
  const routeBot = useRouteBotProject();
  const { isMobile, setOpenMobile } = useSidebar();
  const { openMainConversation, openThread } = useBotActions();
  const handleNewThread = useNewThreadHandler();
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const supported = useEnvironmentSupportsBotConversations(environmentId);
  const canCreate = useAtomValue(botEnvironment.create.permissionAtom(environmentId)) && supported;
  const [query, setQuery] = useState("");
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [newBotOpen, setNewBotOpen] = useState(false);

  const { assistant, specialists } = partitionEnvironmentBots(projects, environmentId);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (bot: EnvironmentProject | null, fallbackTitle: string) =>
    normalizedQuery.length === 0 ||
    (bot?.title ?? fallbackTitle).toLowerCase().includes(normalizedQuery);
  const conversationsFor = (bot: EnvironmentProject) =>
    orderBotConversations(
      threads.filter(
        (thread) =>
          thread.environmentId === bot.environmentId &&
          thread.projectId === bot.id &&
          !isSidebarSubagentThread(thread),
      ),
      bot.botMainThreadId,
    );

  const closeMobileSheet = () => {
    if (isMobile) setOpenMobile(false);
  };
  const openBot = async (bot: EnvironmentProject | null) => {
    if (environmentId === null || openingKey !== null) return;
    const key = bot?.botRole === "assistant" || bot === null ? "assistant" : bot.id;
    setOpeningKey(key);
    const opened = await openMainConversation(environmentId, bot);
    setOpeningKey((current) => (current === key ? null : current));
    if (opened) closeMobileSheet();
  };
  const openTopic = (thread: SidebarThreadSummary) => {
    closeMobileSheet();
    void openThread(scopeThreadRef(thread.environmentId, thread.id));
  };
  const startTopic = (bot: EnvironmentProject) => {
    closeMobileSheet();
    void handleNewThread(scopeProjectRef(bot.environmentId, bot.id));
  };

  const renderConversations = (bot: EnvironmentProject) => {
    if (routeBot?.id !== bot.id || routeBot.environmentId !== bot.environmentId) return null;
    const { main, topics } = conversationsFor(bot);
    return (
      <SidebarMenuSub>
        {main ? (
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              render={<button type="button" />}
              isActive={routeThreadRef?.threadId === main.id}
              aria-disabled={openingKey !== null || undefined}
              onClick={() => void openBot(bot)}
            >
              <PinIcon />
              <span>Main conversation</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ) : null}
        {topics.map((thread) => (
          <SidebarMenuSubItem key={thread.id}>
            <SidebarMenuSubButton
              render={<button type="button" />}
              isActive={routeThreadRef?.threadId === thread.id}
              onClick={() => openTopic(thread)}
            >
              <MessageSquareIcon />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <StatusDot thread={thread} />
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
        {canOperate ? (
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              render={<button type="button" />}
              size="sm"
              onClick={() => startTopic(bot)}
            >
              <PlusIcon />
              <span>New topic</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ) : null}
      </SidebarMenuSub>
    );
  };

  const assistantMain = assistant ? conversationsFor(assistant).main : null;
  const assistantPill = assistantMain ? resolveThreadStatusPill({ thread: assistantMain }) : null;
  // Before Assistant exists, opening it creates it, which needs a writable connection to a server
  // that supports bots.
  const canProvision = canOperate && supported;
  const assistantUnavailable = environmentId === null || (assistant === null && !canProvision);
  const visibleSpecialists = specialists.filter((bot) => matches(bot, bot.title));

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex flex-col gap-2">
              <SidebarRoomSwitch room="bots" />
              <EnvironmentPicker environmentId={environmentId} />
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
                {canCreate ? (
                  <SidebarHeaderIconButton label="New bot" onClick={() => setNewBotOpen(true)}>
                    <PlusIcon />
                  </SidebarHeaderIconButton>
                ) : null}
              </div>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          <SidebarMenu aria-label="Bots">
            {matches(assistant, "Assistant") ? (
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={assistantMain !== null && routeThreadRef?.threadId === assistantMain.id}
                  disabled={assistantUnavailable || openingKey === "assistant"}
                  aria-current={
                    routeBot !== null && routeBot.id === assistant?.id ? "page" : undefined
                  }
                  onClick={() => void openBot(assistant)}
                >
                  <BotAvatar
                    bot={assistant ?? { id: "assistant", title: "Assistant", botRole: "assistant" }}
                    size="md"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold text-sidebar-foreground">
                      {assistant?.title ?? "Assistant"}
                    </span>
                    <span className="truncate text-xs font-normal text-sidebar-muted-foreground">
                      {openingKey === "assistant"
                        ? "Opening…"
                        : (assistantPill?.label ??
                          (assistant === null
                            ? canProvision
                              ? "Start a conversation"
                              : supported
                                ? "Not set up on this environment"
                                : "Needs a newer server"
                            : "Ongoing conversation"))}
                    </span>
                  </span>
                </SidebarMenuButton>
                {assistant ? renderConversations(assistant) : null}
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
          {visibleSpecialists.length > 0 ? <Separator className="my-1.5" /> : null}
          <SidebarMenu aria-label="Specialists">
            {visibleSpecialists.map((bot) => {
              const { main } = conversationsFor(bot);
              return (
                <SidebarMenuItem key={bot.id}>
                  <SidebarMenuButton
                    isActive={main !== null && routeThreadRef?.threadId === main.id}
                    disabled={openingKey === bot.id}
                    aria-current={routeBot?.id === bot.id ? "page" : undefined}
                    onClick={() => void openBot(bot)}
                  >
                    <BotAvatar bot={bot} />
                    <span className="min-w-0 flex-1 truncate">{bot.title}</span>
                    <StatusDot thread={main} />
                  </SidebarMenuButton>
                  {renderConversations(bot)}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
          {normalizedQuery.length > 0 &&
          visibleSpecialists.length === 0 &&
          !matches(assistant, "Assistant") ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
            >
              No bots found
            </p>
          ) : null}
          {environmentId === null ? (
            <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
              Connect an environment to use bots.
            </p>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      {environmentId !== null ? (
        <NewBotDialog
          key={environmentId}
          environmentId={environmentId}
          open={newBotOpen}
          onOpenChange={setNewBotOpen}
          onCreated={closeMobileSheet}
        />
      ) : null}
    </>
  );
}
