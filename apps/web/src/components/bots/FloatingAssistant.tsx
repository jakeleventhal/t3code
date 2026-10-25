import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type RunId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  ListOrderedIcon,
  MaximizeIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { botOutbox, botOutboxHoldsThread, createBotOutboxItem } from "../../botOutbox/botOutbox";
import { classifyBotOutboxFailure, type BotOutboxItem } from "../../botOutbox/botOutbox.logic";
import { useComposerDraftStore } from "../../composerDraftStore";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn, newMessageId } from "../../lib/utils";
import {
  deriveCanInterruptRunningThread,
  deriveTimelineEntriesFromVisibleTurnItems,
  type WorkLogEntry,
} from "../../session-logic";
import {
  readProjects,
  readThreadShell,
  useEnvironmentSupportsBotConversations,
  useProjects,
  useQuietThreadShell,
  useThreadProjection,
  useThreadShell,
} from "../../state/entities";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope, useLastKnownEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useCurrentViewReader } from "../../voice/currentView";
import { useHasVoiceCall, useVoiceCall } from "../../voice/useVoiceCall";
import ChatMarkdown from "../ChatMarkdown";
import { workEntryDisplayLabel } from "../chat/MessagesTimeline.logic";
import { formatWorkingTimerNow } from "../chat/TimelineWorkGroupRows.logic";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ASSISTANT_CARD_TURN_LIMIT,
  assistantCardRows,
  recentTurnItems,
  resolveAssistantCardStatus,
  type AssistantCardRow,
  type AssistantCardStatus,
  type AssistantCardTone,
} from "./assistantCard.logic";
import { BotAvatar } from "./BotAvatar";
import { BotCallStartButton } from "./BotCallStartButton";
import { BotOutboxCardList } from "./BotOutboxQueue";
import { PeerRequestCardList } from "./PeerRequestQueue";
import { startBotCall } from "./botCallActions";
import { partitionEnvironmentBots } from "./botRoom.logic";
import { readAssistantQuickState, useBotRoomStore } from "./botRoomStore";
import { useBotSendReadiness } from "./BotRuntimeSettings";
import {
  BOTS_UNSUPPORTED_MESSAGE,
  DISCONNECTED_MESSAGE,
  readBotSendSettings,
  useBotActions,
} from "./useBotActions";
import { useBotCallAvailability } from "./useBotCallAvailability";
import { useDesignatedAssistantEnvironmentId } from "./useBotRoom";

const UNAVAILABLE_MESSAGE = "Assistant isn’t set up on this environment.";
const OFFLINE_QUEUE_MESSAGE = "Not connected. Messages you send wait here until it reconnects.";

const TONE_DOT_CLASS: Record<AssistantCardTone, string | null> = {
  idle: null,
  sending: "bg-info",
  working: "bg-info",
  "needs-you": "bg-warning",
  failed: "bg-destructive",
  offline: "bg-muted-foreground",
};

/**
 * Code's quiet way into Assistant: a corner button that reveals Call on hover or focus, and a
 * card on the same main conversation with its real progress. The card's transcript mounts only
 * while it is open, so Code never streams Assistant's thread in the background. A live call takes
 * the corner's place.
 */
export function FloatingAssistant() {
  const environmentId = useDesignatedAssistantEnvironmentId();
  const onCall = useHasVoiceCall();
  const slot = useBotRoomStore((state) => state.assistantOrbSlot);
  if (environmentId === null || onCall) return null;
  return createPortal(
    <AssistantCorner key={environmentId} environmentId={environmentId} slotted={slot !== null} />,
    slot ?? document.body,
  );
}

function AssistantCorner({
  environmentId,
  slotted,
}: {
  environmentId: EnvironmentId;
  slotted: boolean;
}) {
  const open = useBotRoomStore((state) => state.assistantPanelOpen);
  const setOpen = useBotRoomStore((state) => state.setAssistantPanelOpen);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "assistant.toggle");
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const projects = useProjects();
  const { assistant } = partitionEnvironmentBots(projects, environmentId);
  const name = assistant?.title ?? "Assistant";
  const mainThreadId = assistant?.botMainThreadId ?? null;
  const mainThreadRef = mainThreadId ? scopeThreadRef(environmentId, mainThreadId) : null;
  const shell = useQuietThreadShell(mainThreadRef);
  const connected = useConnectedEnvironmentIds().includes(environmentId);
  const sending = useBotRoomStore((state) => readAssistantQuickState(state, environmentId).sending);
  const status = resolveAssistantCardStatus({ connected, sending, thread: shell });
  const call = useAssistantCall(environmentId, assistant, () => setOpen(false));

  const close = () => {
    setOpen(false);
    orbRef.current?.focus({ preventScroll: true });
  };
  const orbLabel = `${name}, ${status.label}${shortcutLabel ? ` (${shortcutLabel})` : ""}`;
  const dotClass = open ? null : TONE_DOT_CLASS[status.tone];

  return (
    <div
      className={cn(
        "pointer-events-auto z-30",
        slotted ? "absolute right-0 bottom-0" : "fixed right-4 bottom-4",
      )}
    >
      {open ? (
        <AssistantCard
          environmentId={environmentId}
          assistant={assistant}
          status={status}
          call={call}
          onClose={close}
        />
      ) : null}
      {/* Column-reversed so Call sits above the button while Tab still reaches the button first. */}
      <div className="group/assistant-corner flex flex-col-reverse items-end gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                ref={orbRef}
                variant="default"
                size="lg"
                aria-label={orbLabel}
                aria-expanded={open}
                aria-haspopup="dialog"
                onClick={() => setOpen(!open)}
              />
            }
          >
            <SparklesIcon />
            <span>{name}</span>
            {dotClass ? (
              <span
                aria-hidden
                className={cn(
                  "absolute -top-px -right-px size-2.5 rounded-full border-2 border-background",
                  dotClass,
                )}
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="left">{orbLabel}</TooltipPopup>
        </Tooltip>
        {open ? null : (
          <div className="hidden group-hover/assistant-corner:flex group-focus-within/assistant-corner:flex">
            <BotCallStartButton
              environmentId={environmentId}
              bot={{ id: assistant?.id ?? "assistant", title: name, botRole: "assistant" }}
              threadId={mainThreadId}
              active={call.active}
              availability={call.availability}
              onStart={call.start}
              onOpenActive={() => undefined}
              prominent
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Calling is an explicit action, so it may create Assistant's conversation; opening the card never does. */
function useAssistantCall(
  environmentId: EnvironmentId,
  assistant: EnvironmentProject | null,
  onStarting: () => void,
) {
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const supported = useEnvironmentSupportsBotConversations(environmentId);
  const active = useVoiceCall();
  const routeAvailability = useBotCallAvailability(environmentId, assistant?.id ?? null);
  const { ensureMainThread } = useBotActions();
  // Setting Assistant up is a write on a server that supports it; without one, only an
  // Assistant that already exists can be used.
  const unavailable = assistant === null && (!canOperate || !supported);
  const availability = unavailable
    ? {
        kind: "unavailable" as const,
        reason: supported ? UNAVAILABLE_MESSAGE : BOTS_UNSUPPORTED_MESSAGE,
      }
    : routeAvailability;
  const start = ({ replacingCallId }: { readonly replacingCallId: string | null }) => {
    onStarting();
    void (async () => {
      const ref = await ensureMainThread(environmentId, assistant);
      if (ref === null) return;
      const project = partitionEnvironmentBots(readProjects(), environmentId).assistant;
      if (project === null) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Couldn’t start the call",
            description: "Assistant is still starting. Try again in a moment.",
          }),
        );
        return;
      }
      await startBotCall(
        {
          environmentId,
          bot: { id: project.id, title: project.title, botRole: project.botRole ?? null },
          threadRef: ref,
        },
        replacingCallId,
      );
    })();
  };
  return { active, availability, start, unavailable, canOperate, supported };
}

type AssistantCall = ReturnType<typeof useAssistantCall>;

function AssistantCard({
  environmentId,
  assistant,
  status,
  call,
  onClose,
}: {
  environmentId: EnvironmentId;
  assistant: EnvironmentProject | null;
  status: AssistantCardStatus;
  call: AssistantCall;
  onClose: () => void;
}) {
  const name = assistant?.title ?? "Assistant";
  const mainThreadId = assistant?.botMainThreadId ?? null;
  const mainThreadRef = mainThreadId ? scopeThreadRef(environmentId, mainThreadId) : null;
  // The live shell, so the timer and Stop follow the run the moment it changes.
  const shell = useThreadShell(mainThreadRef);
  const thread = useThreadProjection(shell === null ? null : mainThreadRef);
  const projection = thread?.projection ?? null;
  const connected = status.tone !== "offline";
  const { openMainConversation } = useBotActions();
  const navigate = useNavigate();
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const cancelQueuedRun = useAtomCommand(threadEnvironment.cancelQueuedRun);
  const { send, draft, sending, error } = useAssistantSend(environmentId, assistant, connected);

  const rows = projection
    ? assistantCardRows(
        deriveTimelineEntriesFromVisibleTurnItems({
          visibleTurnItems: recentTurnItems(projection.visibleTurnItems, ASSISTANT_CARD_TURN_LIMIT),
          optimisticMessages: [],
          attempts: projection.attempts,
          nodes: projection.nodes,
          plans: projection.plans,
        }),
      )
    : [];
  const queuedRuns = projection ? deriveThreadQueueWorkflowState(projection).queuedRuns : [];
  const runtime = shell?.runtime ?? null;
  const working = status.tone === "working";
  const activeRunId = working ? (runtime?.activeRunId ?? null) : null;
  const cwd = assistant?.workspaceRoot;
  const describe = (entry: WorkLogEntry) => workEntryDisplayLabel(entry, cwd);
  const step = working ? "Working on your request" : null;
  const canOperate = call.canOperate;
  const canStop =
    canOperate && connected && deriveCanInterruptRunningThread(shell !== null, runtime);
  const turn = useBotSendReadiness(environmentId, assistant?.id ?? null, shell);
  const setupNeeded = turn?.kind === "setup-needed" ? turn : null;
  // Offline, a message to an existing conversation waits on this device until it reconnects. The
  // live grant can't be read then, so the last one the host answered with stands in.
  const lastKnownCanOperate = useLastKnownEnvironmentScope(
    environmentId,
    AuthOrchestrationOperateScope,
  );
  const queuesOffline = !connected && mainThreadId !== null && lastKnownCanOperate;
  const canSend =
    (connected ? canOperate : queuesOffline) && !call.unavailable && setupNeeded === null;
  // A message sent mid-reply waits on the server for its turn rather than interrupting it.
  const queues = shell !== null && threadRuntimeIsActive(shell.runtime);

  const stop = async () => {
    if (mainThreadId === null || !canStop) return;
    const result = await interruptTurn({ environmentId, input: { threadId: mainThreadId } });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t stop Assistant",
          description: failure instanceof Error ? failure.message : "An error occurred.",
        }),
      );
    }
  };
  const openChat = () => {
    // An unsent draft goes with you, unless the full chat already holds one of its own.
    if (mainThreadRef !== null && !sending && draft.trim().length > 0) {
      const drafts = useComposerDraftStore.getState();
      if ((drafts.getComposerDraft(mainThreadRef)?.prompt ?? "").trim().length === 0) {
        drafts.setPrompt(mainThreadRef, draft);
        useBotRoomStore.getState().setAssistantDraft(environmentId, "");
      }
    }
    onClose();
    void openMainConversation(environmentId, assistant, { fromCode: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "." && (event.metaKey || event.ctrlKey) && canStop) {
      event.preventDefault();
      void stop();
    }
  };

  const emptyMessage = !connected
    ? queuesOffline
      ? OFFLINE_QUEUE_MESSAGE
      : DISCONNECTED_MESSAGE
    : call.unavailable
      ? call.supported
        ? UNAVAILABLE_MESSAGE
        : BOTS_UNSUPPORTED_MESSAGE
      : mainThreadRef === null || shell === null
        ? "Ask anything. This starts your Assistant conversation."
        : projection === null
          ? null
          : "No messages yet.";

  return (
    <div
      role="dialog"
      aria-label={name}
      onKeyDown={onKeyDown}
      className="absolute right-0 bottom-full mb-2 flex h-[min(426px,calc(100dvh-14rem))] min-h-64 w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="flex items-start gap-2.5 border-b py-2 pr-2 pl-3">
        <BotAvatar
          bot={assistant ?? { id: "assistant", title: "Assistant", botRole: "assistant" }}
          size="lg"
        />
        <div className="flex min-w-0 flex-1 flex-col pt-px">
          <span className="text-sm leading-tight font-semibold wrap-anywhere">{name}</span>
          <StatusWord status={status} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <BotCallStartButton
            environmentId={environmentId}
            bot={{ id: assistant?.id ?? "assistant", title: name, botRole: "assistant" }}
            threadId={mainThreadId}
            active={call.active}
            availability={call.availability}
            onStart={call.start}
            onOpenActive={onClose}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Open full chat in Bots"
                  // Offline, a loaded conversation can still be read; nothing else can be opened.
                  disabled={call.unavailable || (!connected && shell === null)}
                  onClick={openChat}
                />
              }
            >
              <MaximizeIcon />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Open full chat</TooltipPopup>
          </Tooltip>
          <Button size="icon-xs" variant="ghost-muted" aria-label="Close (Esc)" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      </div>
      <AssistantTranscript
        rows={rows.filter((row) => row.kind !== "steps")}
        threadRef={mainThreadRef}
        cwd={cwd}
        activeRunId={activeRunId}
        emptyMessage={emptyMessage}
        loading={shell !== null && projection === null && connected}
        describe={describe}
        onOpenChat={openChat}
      />
      <AssistantStrip
        status={status}
        step={step}
        canStop={canStop}
        onStop={() => void stop()}
        onOpenChat={openChat}
        sendError={error}
        connected={connected}
        offlineMessage={queuesOffline ? OFFLINE_QUEUE_MESSAGE : DISCONNECTED_MESSAGE}
        setupReason={setupNeeded?.reason ?? null}
        onFixSetup={() => {
          onClose();
          void navigate({ to: "/settings/bots", search: { machine: environmentId } });
        }}
      />
      {queuedRuns.length > 0 && mainThreadId !== null ? (
        <ul aria-label="Queued messages" className="flex flex-col gap-1 px-2.5 pb-1.5">
          {queuedRuns.map(({ run, text }) => (
            <QueuedRow
              key={run.id}
              text={text}
              canCancel={canOperate && connected}
              onCancel={() =>
                void cancelQueuedRun({
                  environmentId,
                  input: { threadId: mainThreadId, runId: run.id },
                })
              }
            />
          ))}
        </ul>
      ) : null}
      <BotOutboxCardList environmentId={environmentId} threadId={mainThreadId} />
      <PeerRequestCardList
        environmentId={environmentId}
        threadId={mainThreadId}
        onNavigate={onClose}
      />
      <AssistantComposer
        name={name}
        draft={draft}
        sending={sending}
        canSend={canSend}
        queues={queues}
        queuesOffline={queuesOffline}
        connected={connected}
        canOperate={canOperate}
        setupNeeded={setupNeeded !== null}
        onChange={(value) => useBotRoomStore.getState().setAssistantDraft(environmentId, value)}
        onSend={() => void send()}
      />
    </div>
  );
}

function StatusWord({ status }: { status: AssistantCardStatus }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs",
        status.tone === "needs-you"
          ? "text-warning-foreground"
          : status.tone === "failed"
            ? "text-destructive-foreground"
            : "text-muted-foreground",
      )}
    >
      {TONE_DOT_CLASS[status.tone] ? (
        <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT_CLASS[status.tone])} />
      ) : null}
      {status.label}
    </span>
  );
}

function AssistantTranscript({
  rows,
  threadRef,
  cwd,
  activeRunId,
  emptyMessage,
  loading,
  describe,
  onOpenChat,
}: {
  rows: ReadonlyArray<AssistantCardRow>;
  threadRef: ScopedThreadRef | null;
  cwd: string | undefined;
  activeRunId: RunId | null;
  emptyMessage: string | null;
  loading: boolean;
  describe: (entry: WorkLogEntry) => string;
  onOpenChat: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Opening lands on the latest reply; after that the view follows new text only while the
  // reader is already at the bottom, so scrolling back to read is never yanked away.
  const followRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller !== null && followRef.current) scroller.scrollTop = scroller.scrollHeight;
  });
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 28;
    followRef.current = atBottom;
    if (showJump === atBottom) setShowJump(!atBottom);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        tabIndex={0}
        aria-label="Conversation"
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-3 py-3 text-sm scrollbar-gutter-both outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {rows.length === 0 ? (
          loading ? (
            <p className="m-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="xs" />
              Loading the conversation…
            </p>
          ) : emptyMessage ? (
            <p className="m-auto px-4 text-center text-xs text-muted-foreground">{emptyMessage}</p>
          ) : null
        ) : (
          rows.map((row) => (
            <TranscriptRow
              key={row.id}
              row={row}
              threadRef={threadRef}
              cwd={cwd}
              live={row.kind === "steps" && activeRunId !== null && row.runId === activeRunId}
              describe={describe}
              onOpenChat={onOpenChat}
            />
          ))
        )}
      </div>
      {showJump ? (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const scroller = scrollerRef.current;
              if (scroller === null) return;
              followRef.current = true;
              scroller.scrollTop = scroller.scrollHeight;
              setShowJump(false);
            }}
          >
            <ArrowDownIcon />
            Latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TranscriptRow({
  row,
  threadRef,
  cwd,
  live,
  describe,
  onOpenChat,
}: {
  row: AssistantCardRow;
  threadRef: ScopedThreadRef | null;
  cwd: string | undefined;
  live: boolean;
  describe: (entry: WorkLogEntry) => string;
  onOpenChat: () => void;
}) {
  switch (row.kind) {
    case "user": {
      const attachments = row.message.attachments?.length ?? 0;
      const body = (
        <>
          {row.message.text.trim().length > 0 ? row.message.text : null}
          {attachments > 0 ? (
            <span className="block text-xs text-muted-foreground">
              {attachments === 1 ? "1 attachment" : `${attachments} attachments`}
            </span>
          ) : null}
        </>
      );
      if (row.sender === "you") {
        return (
          <div className="max-w-[88%] self-end rounded-xl bg-secondary px-2.5 py-1.5 whitespace-pre-wrap wrap-anywhere">
            {body}
          </div>
        );
      }
      return (
        <div className="max-w-[92%] self-start rounded-lg border px-2.5 py-1.5 whitespace-pre-wrap wrap-anywhere">
          <SenderLabel
            sender={row.sender}
            environmentId={threadRef?.environmentId ?? null}
            senderThreadId={row.message.senderThreadId ?? null}
          />
          {body}
        </div>
      );
    }
    case "assistant":
      return (
        <div className="min-w-0 wrap-anywhere">
          <ChatMarkdown
            text={row.message.text}
            cwd={cwd}
            threadRef={threadRef ?? undefined}
            isStreaming={row.message.streaming}
          />
        </div>
      );
    case "steps":
      return <StepsGroup entries={row.entries} live={live} describe={describe} />;
    case "error":
      return <p className="text-xs text-destructive-foreground wrap-anywhere">{row.text}</p>;
    case "artifact":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {row.label}.
          <Button size="micro" variant="link" onClick={onOpenChat}>
            Open in full chat
          </Button>
        </p>
      );
  }
}

/** Another bot or a routine put this here; say who, so it never reads as the user's own words. */
function SenderLabel({
  sender,
  environmentId,
  senderThreadId,
}: {
  sender: "bot" | "routine";
  environmentId: EnvironmentId | null;
  senderThreadId: ThreadId | null;
}) {
  const source = useQuietThreadShell(
    environmentId !== null && senderThreadId !== null
      ? scopeThreadRef(environmentId, senderThreadId)
      : null,
  );
  return (
    <span className="block text-xs text-muted-foreground">
      {sender === "routine"
        ? "From a routine"
        : source
          ? `From “${source.title}”`
          : "From another conversation"}
    </span>
  );
}

function StepsGroup({
  entries,
  live,
  describe,
}: {
  entries: ReadonlyArray<WorkLogEntry>;
  live: boolean;
  describe: (entry: WorkLogEntry) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const last = entries.at(-1);
  const failed = entries.filter(
    (entry) => entry.toolLifecycleStatus === "failed" || entry.toolLifecycleStatus === "declined",
  ).length;
  if (last === undefined) return null;
  const count = `${entries.length} ${entries.length === 1 ? "step" : "steps"}`;
  return (
    <div className={cn("overflow-hidden rounded-lg border text-xs", live && "border-info/45")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground hover:bg-accent/50"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{describe(last)}</span>
        </span>
        <span className="shrink-0 tabular-nums">
          {failed > 0 ? `${count} · ${failed} failed` : count}
        </span>
      </button>
      {expanded ? (
        <ol className="flex flex-col gap-1 border-t px-2 py-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-1.5 text-muted-foreground">
              <StepIcon entry={entry} live={live} />
              <span className="min-w-0 flex-1 truncate">{describe(entry)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StepIcon({ entry, live }: { entry: WorkLogEntry; live: boolean }) {
  const status = entry.toolLifecycleStatus;
  if (status === "inProgress" && live) return <Spinner size="xs" tone="muted" />;
  if (status === "failed" || status === "declined") {
    return <XIcon aria-label="Failed" className="size-3 shrink-0 text-destructive-foreground" />;
  }
  if (status === "stopped") return <SquareIcon aria-label="Stopped" className="size-3 shrink-0" />;
  if (status === "completed") return <CheckIcon aria-label="Done" className="size-3 shrink-0" />;
  return <CircleIcon aria-hidden className="size-2 shrink-0" />;
}

/** What is happening right now, beside the composer: the step truncates, the timer never does. */
function AssistantStrip({
  status,
  step,
  canStop,
  onStop,
  onOpenChat,
  sendError,
  connected,
  offlineMessage,
  setupReason,
  onFixSetup,
}: {
  status: AssistantCardStatus;
  step: string | null;
  canStop: boolean;
  onStop: () => void;
  onOpenChat: () => void;
  sendError: string | null;
  connected: boolean;
  offlineMessage: string;
  /** The configured model can't run here; Send stays off rather than using another model. */
  setupReason: string | null;
  onFixSetup: () => void;
}) {
  const strip = (() => {
    switch (status.tone) {
      case "working":
        return (
          <>
            <Spinner size="xs" tone="muted" />
            <span className="min-w-0 flex-1 truncate" role="status">
              {step ?? (status.label === "Working" ? "Thinking" : status.label)}
            </span>
            {status.startedAt ? (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                <WorkingTimer startedAt={status.startedAt} />
              </span>
            ) : null}
            {canStop ? (
              <Button size="xs" variant="outline" onClick={onStop} aria-keyshortcuts="Meta+.">
                <SquareIcon />
                Stop
              </Button>
            ) : null}
          </>
        );
      case "needs-you":
        return (
          <>
            <span className="min-w-0 flex-1 text-warning-foreground" role="status">
              Waiting on you to approve or answer.
            </span>
            <Button size="xs" variant="outline" onClick={onOpenChat}>
              Open chat
            </Button>
          </>
        );
      case "failed":
        return (
          <span className="min-w-0 flex-1 text-destructive-foreground wrap-anywhere" role="status">
            {status.error ?? "The last reply failed."}
          </span>
        );
      case "sending":
        return (
          <>
            <Spinner size="xs" tone="muted" />
            <span className="min-w-0 flex-1 truncate" role="status">
              Sending…
            </span>
          </>
        );
      case "offline":
        return (
          <span className="min-w-0 flex-1 text-muted-foreground" role="status">
            {connected ? null : offlineMessage}
          </span>
        );
      case "idle":
        return null;
    }
  })();
  if (strip === null && sendError === null && setupReason === null) return null;
  return (
    <div className="flex flex-col gap-1 border-t px-3 py-1.5 text-xs">
      {strip ? <div className="flex min-h-6 items-center gap-2">{strip}</div> : null}
      {setupReason ? (
        <div className="flex min-h-6 items-center gap-2">
          <span className="min-w-0 flex-1 text-warning-foreground wrap-anywhere" role="status">
            {`Setup needed: ${setupReason}`}
          </span>
          <Button size="xs" variant="outline" onClick={onFixSetup}>
            Bot settings
          </Button>
        </div>
      ) : null}
      {sendError ? (
        <p className="text-destructive-foreground wrap-anywhere" role="alert">
          {sendError}
        </p>
      ) : null}
    </div>
  );
}

function WorkingTimer({ startedAt }: { startedAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (textRef.current) textRef.current.textContent = formatWorkingTimerNow(startedAt);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span ref={textRef}>{formatWorkingTimerNow(startedAt)}</span>;
}

function QueuedRow({
  text,
  canCancel,
  onCancel,
}: {
  text: string;
  canCancel: boolean;
  onCancel: () => void;
}) {
  return (
    <li className="flex items-center gap-1.5 rounded-lg border border-dashed py-1 pr-1 pl-2 text-xs text-muted-foreground">
      <ListOrderedIcon aria-hidden className="size-3 shrink-0" />
      <span className="shrink-0">Queued</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{text}</span>
      {canCancel ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Cancel queued message"
          onClick={onCancel}
        >
          <XIcon />
        </Button>
      ) : null}
    </li>
  );
}

function AssistantComposer({
  name,
  draft,
  sending,
  canSend,
  queues,
  queuesOffline,
  connected,
  canOperate,
  setupNeeded,
  onChange,
  onSend,
}: {
  name: string;
  draft: string;
  sending: boolean;
  canSend: boolean;
  queues: boolean;
  queuesOffline: boolean;
  connected: boolean;
  canOperate: boolean;
  setupNeeded: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const ready = canSend && !sending && draft.trim().length > 0;
  const sendLabel = queuesOffline
    ? "Queue: sends when this environment reconnects"
    : queues
      ? "Queue: sends when this reply ends"
      : "Send";
  return (
    <form
      className="flex items-end gap-1.5 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSend();
      }}
    >
      <textarea
        autoFocus
        rows={1}
        dir="auto"
        aria-label={`Message ${name}`}
        placeholder={
          canSend
            ? queuesOffline
              ? "Not connected: this sends when it reconnects"
              : queues
                ? "Message queues until this reply ends"
                : `Ask ${name}…`
            : !connected
              ? "Waiting for this environment to reconnect"
              : setupNeeded
                ? "Choose a model Assistant can use first"
                : canOperate
                  ? "Assistant isn’t available here"
                  : "This connection can’t send messages"
        }
        disabled={!canSend}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (ready) onSend();
        }}
        className="field-sizing-content max-h-30 min-h-8 min-w-0 flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-64"
      />
      <Tooltip>
        <TooltipTrigger
          render={<Button type="submit" size="icon-sm" aria-label={sendLabel} disabled={!ready} />}
        >
          {sending ? <Spinner /> : queues || queuesOffline ? <ListOrderedIcon /> : <ArrowUpIcon />}
        </TooltipTrigger>
        <TooltipPopup side="top">{sendLabel}</TooltipPopup>
      </Tooltip>
    </form>
  );
}

/**
 * State lives in the store per environment: a send outlives a closed card, and its result lands on
 * the environment it was sent to.
 */
function useAssistantSend(
  environmentId: EnvironmentId,
  assistant: EnvironmentProject | null,
  connected: boolean,
) {
  const { draft, sending, error } = useBotRoomStore((state) =>
    readAssistantQuickState(state, environmentId),
  );
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const { ensureMainThread } = useBotActions();
  const readView = useCurrentViewReader();

  const send = async () => {
    const store = useBotRoomStore.getState();
    const submitted = store.beginAssistantSend(environmentId);
    if (submitted === null) return;
    // Read at Send, so the message describes the screen it was written about.
    const viewContext = readView();
    const finish = (outcome: Parameters<typeof store.finishAssistantSend>[2]) =>
      useBotRoomStore.getState().finishAssistantSend(environmentId, submitted, outcome);
    try {
      // Offline, or behind messages still waiting here, the message joins that queue so they
      // arrive in the order written.
      const mainThreadId = assistant?.botMainThreadId ?? null;
      const queue = async (item: BotOutboxItem) => {
        try {
          await botOutbox.enqueue(item);
          return finish({ sent: true });
        } catch (failure) {
          return finish({
            sent: false,
            error: `Couldn’t save the message on this device${
              failure instanceof Error ? `: ${failure.message}` : "."
            }`,
          });
        }
      };
      if (
        mainThreadId !== null &&
        (!connected || botOutboxHoldsThread(environmentId, mainThreadId))
      ) {
        const currentView = await viewContext;
        return await queue(
          createBotOutboxItem({
            messageId: newMessageId(),
            environmentId,
            threadId: mainThreadId,
            text: submitted.trim(),
            ...(currentView ? { context: { version: 1, records: [], currentView } } : {}),
          }),
        );
      }
      const ref = await ensureMainThread(environmentId, assistant);
      // ensureMainThread already told the user why.
      if (ref === null) return finish({ sent: false, error: null });
      const thread = readThreadShell(ref);
      if (thread === null) {
        return finish({
          sent: false,
          error: "Assistant is still starting. Try again in a moment.",
        });
      }
      const turn = readBotSendSettings(environmentId, thread.projectId, thread);
      if (turn.kind === "setup-needed") {
        return finish({ sent: false, error: `Setup needed: ${turn.reason}` });
      }
      const currentView = await viewContext;
      // Fixed before sending, so a send whose answer is lost retries as this same command.
      const item = createBotOutboxItem({
        messageId: newMessageId(),
        environmentId,
        threadId: ref.threadId,
        text: submitted.trim(),
        ...(currentView ? { context: { version: 1, records: [], currentView } } : {}),
      });
      const result = await startTurn({
        environmentId,
        input: {
          commandId: item.commandId,
          threadId: ref.threadId,
          message: {
            messageId: item.messageId,
            role: "user",
            text: item.text,
            attachments: [],
            ...(item.context ? { context: item.context } : {}),
          },
          modelSelection: turn.modelSelection,
          runtimeMode: turn.runtimeMode,
          interactionMode: thread.interactionMode,
          // Never interrupt work Assistant is already doing; the message waits its turn.
          dispatchMode: "auto",
          createdAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Success") return finish({ sent: true });
      if (isAtomCommandInterrupted(result)) return finish({ sent: false, error: null });
      const failure = squashAtomCommandFailure(result);
      if (classifyBotOutboxFailure(failure) === "retry") {
        return await queue({ ...item, uncertain: true });
      }
      finish({
        sent: false,
        error: failure instanceof Error ? failure.message : "Could not send the message.",
      });
    } catch (failure) {
      finish({
        sent: false,
        error: failure instanceof Error ? failure.message : "Could not send the message.",
      });
    }
  };
  return { send, draft, sending, error };
}
