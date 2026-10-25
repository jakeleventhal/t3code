import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  presentThreadShell,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type ThreadId } from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronLeftIcon,
  MessagesSquareIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import {
  refreshArchivedThreadsForEnvironment,
  useArchivedThreadSnapshots,
} from "../../lib/archivedThreadsState";
import { cn } from "../../lib/utils";
import { useQuietThreadShells } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { RelativeTime } from "../RelativeTime";
import { isSidebarSubagentThread, resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { archivedBotThreads, matchesBotThreadQuery, orderBotConversations } from "./botRoom.logic";
import { useBotActions } from "./useBotActions";
import { useBotThreadActions, type BotThreadTarget } from "./useBotThreadActions";

const MAIN_CONVERSATION_LABEL = "Main conversation";

/**
 * A bot's threads, tucked behind one header button. The bot's main conversation is where every
 * chat with it starts; threads are the occasional side conversations for parallel work.
 */
export function BotThreadsMenu({
  project,
  activeThreadId,
}: {
  project: EnvironmentProject;
  activeThreadId: ThreadId;
}) {
  const [open, setOpen] = useState(false);
  // Lives above the popover so a rename chosen from a context menu survives the popover closing.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const shells = useQuietThreadShells();
  const { topics: threads } = orderBotConversations(
    shells.filter(
      (thread) =>
        thread.environmentId === project.environmentId &&
        thread.projectId === project.id &&
        !isSidebarSubagentThread(thread),
    ),
    project.botMainThreadId,
  );
  const startRename = (key: string) => {
    setRenamingKey(key);
    setOpen(true);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRenamingKey(null);
      }}
    >
      <PopoverTrigger
        render={<Button size="sm" variant="ghost" aria-label={`${project.title} threads`} />}
      >
        <MessagesSquareIcon />
        Threads
        {threads.length > 0 ? (
          <span className="text-muted-foreground tabular-nums">{threads.length}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" padding="compact" width="md">
        <BotThreadsPanel
          project={project}
          activeThreadId={activeThreadId}
          threads={threads}
          renamingKey={renamingKey}
          onStartRename={startRename}
          onRenameDone={() => setRenamingKey(null)}
          onNavigate={() => setOpen(false)}
        />
      </PopoverPopup>
    </Popover>
  );
}

function BotThreadsPanel({
  project,
  activeThreadId,
  threads,
  renamingKey,
  onStartRename,
  onRenameDone,
  onNavigate,
}: {
  project: EnvironmentProject;
  activeThreadId: ThreadId;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  renamingKey: string | null;
  onStartRename: (key: string) => void;
  onRenameDone: () => void;
  onNavigate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { openMainConversation, openThread } = useBotActions();
  const handleNewThread = useNewThreadHandler();
  const canOperate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const actions = useBotThreadActions(project);
  const visibleThreads = threads.filter((thread) => matchesBotThreadQuery(thread.title, query));
  const showMain = !showArchived && matchesBotThreadQuery(MAIN_CONVERSATION_LABEL, query);

  const open = (threadId: ThreadId) => {
    onNavigate();
    void openThread(scopeThreadRef(project.environmentId, threadId));
  };
  const rowProps = (thread: EnvironmentThreadShell, archived: boolean) => {
    const ref = scopeThreadRef(project.environmentId, thread.id);
    const key = scopedThreadKey(ref);
    const target: BotThreadTarget = { ref, title: thread.title, archived };
    return {
      key,
      target,
      current: thread.id === activeThreadId,
      renaming: renamingKey === key,
      canOperate,
      actions,
      onOpen: () => open(thread.id),
      onStartRename: () => onStartRename(key),
      onRenameDone,
    };
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-8 items-center gap-2 rounded-md border border-input px-2">
        <SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={showArchived ? "Search archived threads" : "Search threads"}
          aria-label={showArchived ? "Search archived threads" : "Search threads"}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {showArchived ? (
        <ArchivedBotThreadList project={project} query={query} rowProps={rowProps} />
      ) : (
        <ul aria-label={`${project.title} threads`} className="flex flex-col">
          {showMain ? (
            <li>
              <button
                type="button"
                aria-current={activeThreadId === project.botMainThreadId ? "page" : undefined}
                onClick={() => {
                  onNavigate();
                  void openMainConversation(project.environmentId, project);
                }}
                className={cn(rowClassName, "w-full")}
              >
                <PinIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">{MAIN_CONVERSATION_LABEL}</span>
              </button>
            </li>
          ) : null}
          {visibleThreads.map((thread) => {
            const { key, ...props } = rowProps(thread, false);
            return <BotThreadRow key={key} {...props} meta={<ThreadMeta thread={thread} />} />;
          })}
          {visibleThreads.length === 0 && query.trim().length > 0 ? (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              No threads found
            </li>
          ) : null}
        </ul>
      )}

      <div className="mt-1 flex items-center justify-between gap-2 border-t pt-2">
        {showArchived ? (
          <Button size="xs" variant="ghost" onClick={() => setShowArchived(false)}>
            <ChevronLeftIcon />
            Threads
          </Button>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              refreshArchivedThreadsForEnvironment(project.environmentId);
              setShowArchived(true);
            }}
          >
            <ArchiveIcon />
            Show archived
          </Button>
        )}
        {canOperate && !showArchived ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              onNavigate();
              void handleNewThread(scopeProjectRef(project.environmentId, project.id));
            }}
          >
            <PlusIcon />
            New thread
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ThreadMeta({ thread }: { thread: EnvironmentThreadShell }) {
  const pill = resolveThreadStatusPill({ thread });
  if (pill !== null) {
    return (
      <span className="flex shrink-0 items-center">
        <span aria-hidden className={cn("size-1.5 rounded-full", pill.dotClass)} />
        <span className="sr-only">{pill.label}</span>
      </span>
    );
  }
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      <RelativeTime timestamp={thread.updatedAt} />
    </span>
  );
}

function ArchivedBotThreadList({
  project,
  query,
  rowProps,
}: {
  project: EnvironmentProject;
  query: string;
  rowProps: (
    thread: EnvironmentThreadShell,
    archived: boolean,
  ) => Omit<Parameters<typeof BotThreadRow>[0], "meta"> & { key: string };
}) {
  const { snapshots, error, isLoading } = useArchivedThreadSnapshots([project.environmentId]);
  const archived = archivedBotThreads(
    snapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => presentThreadShell(environmentId, thread)),
    ),
    project.id,
    project.botMainThreadId,
  ).filter((thread) => matchesBotThreadQuery(thread.title, query));

  if (archived.length === 0) {
    return (
      <p className="flex items-center justify-center gap-2 px-2 py-4 text-center text-xs text-muted-foreground">
        {isLoading ? (
          <Spinner className="size-3.5" />
        ) : error !== null ? (
          error
        ) : query.trim().length > 0 ? (
          "No archived threads found"
        ) : (
          "No archived threads"
        )}
      </p>
    );
  }
  return (
    <ul aria-label={`${project.title} archived threads`} className="flex flex-col">
      {archived.map((thread) => {
        const { key, ...props } = rowProps(thread, true);
        return (
          <BotThreadRow
            key={key}
            {...props}
            meta={
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                <RelativeTime timestamp={thread.archivedAt ?? thread.updatedAt} />
              </span>
            }
          />
        );
      })}
    </ul>
  );
}

const rowClassName =
  "flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:font-medium";

function BotThreadRow({
  target,
  current,
  renaming,
  canOperate,
  actions,
  meta,
  onOpen,
  onStartRename,
  onRenameDone,
}: {
  target: BotThreadTarget;
  current: boolean;
  renaming: boolean;
  canOperate: boolean;
  actions: ReturnType<typeof useBotThreadActions>;
  meta: ReactNode;
  onOpen: () => void;
  onStartRename: () => void;
  onRenameDone: () => void;
}) {
  if (renaming) {
    return (
      <li className="px-1 py-0.5">
        <BotThreadRenameInput target={target} actions={actions} onDone={onRenameDone} />
      </li>
    );
  }
  const openMenu = (event: MouseEvent) => {
    if (!canOperate) return;
    event.preventDefault();
    void actions.openMenu(target, { x: event.clientX, y: event.clientY }, onStartRename);
  };
  return (
    <li className="group/bot-thread relative flex items-center" onContextMenu={openMenu}>
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={onOpen}
        className={cn(rowClassName, "w-full", canOperate && "pe-16")}
      >
        <span className="min-w-0 flex-1 truncate text-left" dir="auto">
          {target.title}
        </span>
        <span
          className={cn(canOperate && "group-hover/bot-thread:invisible pointer-coarse:invisible")}
        >
          {meta}
        </span>
      </button>
      {canOperate ? (
        <span className="absolute end-1 flex items-center opacity-0 group-focus-within/bot-thread:opacity-100 group-hover/bot-thread:opacity-100 pointer-coarse:opacity-100">
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Rename ${target.title}`}
            onClick={onStartRename}
          >
            <PencilIcon />
          </Button>
          {target.archived ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Reopen ${target.title}`}
              onClick={() => void actions.reopen(target)}
            >
              <ArchiveRestoreIcon />
            </Button>
          ) : (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Archive ${target.title}`}
              onClick={() => void actions.archive(target)}
            >
              <ArchiveIcon />
            </Button>
          )}
        </span>
      ) : null}
    </li>
  );
}

export function BotThreadRenameInput({
  target,
  actions,
  onDone,
}: {
  target: BotThreadTarget;
  actions: ReturnType<typeof useBotThreadActions>;
  onDone: () => void;
}) {
  // Enter commits, then unmounting blurs the input; the blur must not commit a second time.
  const settledRef = useRef(false);
  const commit = (value: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    void actions.rename(target, value).then((accepted) => {
      if (accepted) onDone();
      else settledRef.current = false;
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      settledRef.current = true;
      onDone();
    }
  };
  return (
    <input
      autoFocus
      dir="auto"
      aria-label="Thread title"
      defaultValue={target.title}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(event) => commit(event.currentTarget.value)}
      className="h-7 w-full rounded-sm bg-transparent px-1.5 text-sm text-foreground outline-none ring-1 ring-inset ring-ring/50 focus:ring-ring"
    />
  );
}
