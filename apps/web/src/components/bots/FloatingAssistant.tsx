import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { ArrowUpIcon, MaximizeIcon, SparklesIcon, XIcon } from "lucide-react";
import * as Option from "effect/Option";
import { createPortal } from "react-dom";

import { shortcutLabelForCommand } from "../../keybindings";
import { cn, newMessageId } from "../../lib/utils";
import {
  readProjects,
  readThreadShell,
  useEnvironmentSupportsBotConversations,
  useProjects,
  useThreadShell,
} from "../../state/entities";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useCurrentViewReader } from "../../voice/currentView";
import { useHasVoiceCall, useVoiceCall } from "../../voice/useVoiceCall";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";
import { BotCallStartButton } from "./BotCallStartButton";
import { startBotCall } from "./botCallActions";
import { partitionEnvironmentBots } from "./botRoom.logic";
import { readAssistantQuickState, useBotRoomStore } from "./botRoomStore";
import { BOTS_UNSUPPORTED_MESSAGE, DISCONNECTED_MESSAGE, useBotActions } from "./useBotActions";
import { useBotCallAvailability } from "./useBotCallAvailability";
import { useAssistantEnvironmentId } from "./useBotRoom";

const RECENT_MESSAGE_COUNT = 3;

/**
 * Code's quiet way into Assistant: a corner button, a small text panel on the same main
 * conversation, and Open chat for the full thread in Bots. Its contents mount only while open,
 * so Code never streams Assistant's thread in the background. A live call takes its place.
 */
export function FloatingAssistant() {
  const environmentId = useAssistantEnvironmentId();
  const onCall = useHasVoiceCall();
  const slot = useBotRoomStore((state) => state.assistantOrbSlot);
  const open = useBotRoomStore((state) => state.assistantPanelOpen);
  const setOpen = useBotRoomStore((state) => state.setAssistantPanelOpen);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "assistant.toggle");
  if (environmentId === null || onCall) return null;
  const label = shortcutLabel ? `Assistant (${shortcutLabel})` : "Assistant";

  const orb = (
    <div
      className={cn(
        "pointer-events-auto z-30",
        slot === null ? "fixed right-4 bottom-4" : "absolute right-0 bottom-0",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={<Button variant="glass" size="icon-sm" aria-label={label} />}
              />
            }
          >
            <SparklesIcon />
          </TooltipTrigger>
          <TooltipPopup side="left">{label}</TooltipPopup>
        </Tooltip>
        <PopoverPopup side="top" align="end" sideOffset={8} padding="none" width="md">
          <AssistantQuickPanel
            key={environmentId}
            environmentId={environmentId}
            onClose={() => setOpen(false)}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
  return createPortal(orb, slot ?? document.body);
}

function AssistantQuickPanel({
  environmentId,
  onClose,
}: {
  environmentId: EnvironmentId;
  onClose: () => void;
}) {
  const projects = useProjects();
  const { assistant } = partitionEnvironmentBots(projects, environmentId);
  const name = assistant?.title ?? "Assistant";
  const mainThreadId = assistant?.botMainThreadId ?? null;
  const mainThreadRef = mainThreadId ? scopeThreadRef(environmentId, mainThreadId) : null;
  const shell = useThreadShell(mainThreadRef);
  const detail = useEnvironmentThread(environmentId, shell === null ? null : mainThreadId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const supported = useEnvironmentSupportsBotConversations(environmentId);
  const connected = useConnectedEnvironmentIds().includes(environmentId);
  const { draft, sending, error } = useBotRoomStore((state) =>
    readAssistantQuickState(state, environmentId),
  );
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const { ensureMainThread, openMainConversation } = useBotActions();
  const call = useVoiceCall();
  const routeAvailability = useBotCallAvailability(environmentId, assistant?.id ?? null);
  const readView = useCurrentViewReader();

  const recentMessages = (Option.getOrNull(detail.data)?.messages ?? [])
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.workflowScript !== true &&
        message.text.trim().length > 0,
    )
    .slice(-RECENT_MESSAGE_COUNT);
  const pill = shell ? resolveThreadStatusPill({ thread: shell }) : null;
  // Setting Assistant up is a write on a server that supports it; without one, only an
  // Assistant that already exists can be used.
  const unavailable = assistant === null && (!canOperate || !supported);
  const canSend = canOperate && !unavailable && connected;
  const needsChat = shell !== null && (shell.hasPendingApprovals || shell.hasPendingUserInput);

  const callAvailability = unavailable
    ? {
        kind: "unavailable" as const,
        reason: supported
          ? "Assistant isn’t set up on this environment."
          : BOTS_UNSUPPORTED_MESSAGE,
      }
    : routeAvailability;
  // Calling is an explicit action, so it may create Assistant's conversation; opening the panel never does.
  const callAssistant = async (replacingCallId: string | null) => {
    onClose();
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
  };

  const openChat = () => {
    onClose();
    void openMainConversation(environmentId, assistant, { fromCode: true });
  };
  // State lives in the store per environment: a send outlives a closed panel, and its result
  // lands on the environment it was sent to.
  const send = async () => {
    const store = useBotRoomStore.getState();
    const submitted = store.beginAssistantSend(environmentId);
    if (submitted === null) return;
    // Read at Send, so the message describes the screen it was written about.
    const viewContext = readView();
    const finish = (outcome: Parameters<typeof store.finishAssistantSend>[2]) =>
      useBotRoomStore.getState().finishAssistantSend(environmentId, submitted, outcome);
    try {
      const ref = await ensureMainThread(environmentId, assistant);
      // ensureMainThread already told the user why.
      if (ref === null) return finish({ sent: false, error: null });
      // The thread's own settings, as its composer would send them.
      const thread = readThreadShell(ref);
      if (thread === null) {
        return finish({
          sent: false,
          error: "Assistant is still starting. Try again in a moment.",
        });
      }
      const currentView = await viewContext;
      const result = await startTurn({
        environmentId,
        input: {
          threadId: ref.threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: submitted.trim(),
            attachments: [],
            ...(currentView ? { context: { version: 1, records: [], currentView } } : {}),
          },
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          // Never interrupt work Assistant is already doing; the message waits its turn.
          ...(threadRuntimeIsActive(thread.runtime) ? { dispatchMode: "queue" as const } : {}),
          createdAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Success") return finish({ sent: true });
      if (isAtomCommandInterrupted(result)) return finish({ sent: false, error: null });
      const failure = squashAtomCommandFailure(result);
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

  return (
    <div className="flex w-full flex-col" role="dialog" aria-label={`${name} quick panel`}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <BotAvatar
          bot={assistant ?? { id: "assistant", title: "Assistant", botRole: "assistant" }}
        />
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        {pill ? (
          <span className={cn("truncate text-xs", pill.colorClass)}>{pill.label}</span>
        ) : null}
        <span className="flex-1" />
        <BotCallStartButton
          environmentId={environmentId}
          bot={{
            id: assistant?.id ?? "assistant",
            title: name,
            botRole: "assistant",
          }}
          threadId={mainThreadId}
          active={call}
          availability={callAvailability}
          onStart={({ replacingCallId }) => void callAssistant(replacingCallId)}
          onOpenActive={onClose}
        />
        {/* Offline, a loaded conversation can still be read; nothing else can be opened. */}
        <Button
          size="xs"
          variant="outline"
          disabled={unavailable || (!connected && shell === null)}
          onClick={openChat}
        >
          <MaximizeIcon />
          Open chat
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex max-h-56 flex-col justify-end gap-2 overflow-hidden px-3 py-2.5 text-sm">
        {recentMessages.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            {!connected
              ? DISCONNECTED_MESSAGE
              : unavailable
                ? supported
                  ? "Assistant isn’t set up on this environment."
                  : BOTS_UNSUPPORTED_MESSAGE
                : shell === null
                  ? "Ask anything. This starts your Assistant conversation."
                  : "No messages yet."}
          </p>
        ) : (
          recentMessages.map((message) => (
            <p
              key={message.id}
              className={cn(
                "line-clamp-4 whitespace-pre-wrap break-words",
                message.role === "user"
                  ? "max-w-[90%] self-end rounded-xl bg-muted px-2.5 py-1.5"
                  : "max-w-[95%] self-start text-foreground",
              )}
            >
              {message.text}
            </p>
          ))
        )}
        {needsChat ? (
          <p className="text-xs text-warning-foreground">
            {`${name} is waiting on you. Open chat to respond.`}
          </p>
        ) : null}
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </div>
      <form
        className="flex items-center gap-1.5 px-2 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Input
          autoFocus
          size="sm"
          aria-label={`Message ${name}`}
          placeholder={
            canSend
              ? `Ask ${name}…`
              : !connected
                ? "Waiting for this environment to reconnect"
                : canOperate
                  ? "Assistant isn’t available here"
                  : "This connection can’t send messages"
          }
          disabled={!canSend || sending}
          value={draft}
          onChange={(event) =>
            useBotRoomStore.getState().setAssistantDraft(environmentId, event.target.value)
          }
        />
        <Button
          type="submit"
          size="icon-sm"
          aria-label="Send"
          disabled={!canSend || sending || draft.trim().length === 0}
        >
          <ArrowUpIcon />
        </Button>
      </form>
      <div className="flex justify-between px-3 pb-2 text-2xs text-muted-foreground">
        <span className="truncate">{`Same conversation as Bots › ${name}`}</span>
        <span>Esc to close</span>
      </div>
    </div>
  );
}
