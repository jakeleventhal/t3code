import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { VoiceCallState, VoiceCallTarget } from "@t3tools/client-runtime/voice-call";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { botVoiceSelection } from "@t3tools/shared/botPreferences";
import { Atom } from "effect/reactivity";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { botVoiceEnvironment } from "../../state/bot-voice";
import { useEnvironmentServerConfig } from "../../state/entities";
import { voiceCallController } from "../../voice/runtime";
import {
  resolveBotCallAvailability,
  resolveBotCallStart,
  type BotCallAvailability,
  type BotCallSummary,
} from "./bot-call";
import { pressBotCall } from "./BotCallStartButton";

const NO_ENVIRONMENT_PERMISSION = Atom.make(false).pipe(
  Atom.withLabel("mobile-bot-call:no-environment"),
);

/** The live call with its phase; re-renders on every status word, so keep its readers small. */
export function useActiveBotCall(): VoiceCallState | null {
  return useSyncExternalStore(voiceCallController.subscribe, voiceCallController.getSnapshot);
}

let summary: { readonly key: string | null; readonly call: BotCallSummary | null } = {
  key: null,
  call: null,
};
function readSummary(): BotCallSummary | null {
  const call = voiceCallController.getSnapshot();
  const key = call === null ? null : `${call.callId}:${call.phase === "failed"}`;
  if (key !== summary.key) summary = { key, call };
  return summary.call;
}

/**
 * Changes only when a call starts, ends, or fails, so screens that just decide what Call does
 * skip the listening/speaking churn. Its `phase` is current only as failed or not.
 */
export function useBotCallSummary(): BotCallSummary | null {
  return useSyncExternalStore(voiceCallController.subscribe, readSummary);
}

export function sameCallThread(
  call: Pick<VoiceCallTarget, "threadRef"> | null,
  thread: ScopedThreadRef | null,
): boolean {
  return (
    call !== null &&
    thread !== null &&
    call.threadRef.environmentId === thread.environmentId &&
    call.threadRef.threadId === thread.threadId
  );
}

export function botCallBot(
  project: Pick<EnvironmentProject, "id" | "title" | "botRole">,
): VoiceCallTarget["bot"] {
  const botRole = project.botRole ?? null;
  return {
    id: project.id,
    title: project.title,
    botRole,
  };
}

/**
 * Reads the bot's voice from settings already on the device, so a header never fetches the
 * catalog just to render. A null `projectId` is a bot that doesn't exist yet and would get the
 * environment's default voice.
 */
export function useBotCallAvailability(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly connected: boolean;
}): BotCallAvailability {
  const config = useEnvironmentServerConfig(input.environmentId);
  const canCall = useAtomValue(
    input.environmentId === null
      ? NO_ENVIRONMENT_PERMISSION
      : botVoiceEnvironment.begin.permissionAtom(input.environmentId),
  );
  const settings = config?.settings ?? null;
  const selection =
    settings === null || input.projectId === null
      ? null
      : botVoiceSelection(settings, input.projectId).selection;
  return resolveBotCallAvailability({
    supported: config?.environment.capabilities.botVoice === true,
    connected: input.connected && settings !== null,
    canCall,
    selection,
    connection:
      selection === null || settings === null
        ? undefined
        : settings.voiceConnections[selection.connectionId],
  });
}

/**
 * Hands the call to the app-wide runtime, which outlives every screen. A call that fails while
 * connecting says so in its bar; only a request the runtime refuses outright gets an alert.
 */
export function startBotCall(target: VoiceCallTarget, replacingCallId: string | null): void {
  const before = voiceCallController.getSnapshot();
  const pending = voiceCallController.start(
    target,
    replacingCallId === null ? {} : { replacingCallId },
  );
  // The runtime publishes an accepted call before its first await.
  const accepted = voiceCallController.getSnapshot() !== before;
  void pending.then((result) => {
    if (!result.ok && !accepted) Dialog.alert(`Can’t call ${target.bot.title}`, result.error);
  });
}

/**
 * The Call action for a bot conversation's header. Undefined where it has no place: a thread
 * that isn't a bot's, a server without calls, and the conversation already on the call, whose
 * own bar sits above its composer. The handler keeps one identity so the native header isn't
 * rebuilt as availability changes.
 */
export function useBotConversationCall(input: {
  readonly thread: ScopedThreadRef | null;
  readonly project: Pick<EnvironmentProject, "id" | "title" | "botRole"> | null;
  readonly connected: boolean;
  readonly onOpenSettings: (() => void) | undefined;
}): (() => void) | undefined {
  const { thread, project } = input;
  const environmentId = thread?.environmentId ?? null;
  const supported =
    useEnvironmentServerConfig(environmentId)?.environment.capabilities.botVoice === true;
  const availability = useBotCallAvailability({
    environmentId,
    projectId: project?.id ?? null,
    connected: input.connected,
  });
  const active = useBotCallSummary();
  const latest = useRef({ ...input, availability, active });
  useLayoutEffect(() => {
    latest.current = { ...input, availability, active };
  });
  const call = useCallback(() => {
    const { thread, project, availability, active, onOpenSettings } = latest.current;
    if (thread === null || project === null) return;
    const bot = botCallBot(project);
    pressBotCall({
      decision: resolveBotCallStart({
        active,
        target: { environmentId: thread.environmentId, bot, threadId: thread.threadId },
        availability,
      }),
      botTitle: bot.title,
      onStart: ({ replacingCallId }) =>
        startBotCall(
          { environmentId: thread.environmentId, bot, threadRef: thread },
          replacingCallId,
        ),
      // Unreachable: the conversation on the call shows its bar instead of this action.
      onOpenActive: () => {},
      onOpenSettings,
    });
  }, []);
  const onThisCall = active !== null && active.phase !== "failed" && sameCallThread(active, thread);
  const isBot = project?.botRole === "assistant" || project?.botRole === "specialist";
  return isBot && supported && thread !== null && !onThisCall ? call : undefined;
}
