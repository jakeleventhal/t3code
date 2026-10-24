import { openSettings } from "../settings/settings-navigation";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  EnvironmentId,
  MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { cn } from "../../lib/cn";
import { useEnvironmentServerConfig, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { useEnvironmentThread } from "../../state/threads";
import { useCurrentViewReader } from "../../voice/current-view";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { ActiveBotCallBar } from "./ActiveBotCall";
import { assistantQuickStore, useAssistantQuickState } from "./assistant-quick-store";
import type { BotCallAvailability } from "./bot-call";
import { BotAvatar } from "./BotAvatar";
import { BotCallStartButton } from "./BotCallStartButton";
import { useAssistantProject, useShowConversationInBots } from "./use-assistant";
import {
  botCallBot,
  sameCallThread,
  startBotCall,
  useBotCallAvailability,
  useBotCallSummary,
} from "./use-bot-call";
import { useOpenBotConversation } from "./use-bot-conversation";

const ASSISTANT_BOT = { id: "assistant", title: "Assistant", botRole: "assistant" } as const;

const PREVIEW_MESSAGES = 3;

type QuickMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
};

function useRecentMessages(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const state = useEnvironmentThread(environmentId, threadId);
  const projection = Option.getOrNull(state.data);
  const messages = useMemo(() => {
    const recent: QuickMessage[] = [];
    const items = projection?.visibleTurnItems ?? [];
    for (let index = items.length - 1; index >= 0 && recent.length < PREVIEW_MESSAGES; index--) {
      const item = items[index]!.item;
      if (
        (item.type === "user_message" || item.type === "assistant_message") &&
        item.text.trim().length > 0
      ) {
        recent.unshift({
          id: item.id,
          role: item.type === "user_message" ? "user" : "assistant",
          text: item.text.trim(),
        });
      }
    }
    return recent;
  }, [projection?.visibleTurnItems]);
  return {
    messages,
    loading: threadId !== null && projection === null && Option.isNone(state.error),
    error: Option.getOrNull(state.error),
  };
}

/**
 * A short text exchange with the Assistant without leaving Code. It is the same conversation as
 * the full chat in Bots; Open takes the user there.
 */
export function AssistantQuickSheet(props: StaticScreenProps<{ readonly environmentId: string }>) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const showInBots = useShowConversationInBots();
  const environments = useWorkspaceEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const environmentLabel =
    environments.filter((entry) => entry.isEnabled).length > 1
      ? (environment?.environmentLabel ?? null)
      : null;
  const connected = environment?.isEnabled === true && environment.connectionState === "connected";
  const project = useAssistantProject(environmentId);
  const assistantName = project?.title ?? "Assistant";
  const mainThreadId = project?.botMainThreadId ?? null;
  const mainThread = useQuietThreadShell(
    mainThreadId === null ? null : { environmentId, threadId: mainThreadId },
  );
  const opener = useOpenBotConversation(environmentId);
  const [openedThreadId, setOpenedThreadId] = useState<ThreadId | null>(null);
  const known =
    mainThreadId === null
      ? null
      : {
          id: mainThreadId,
          archived: mainThread === null || mainThread.archivedAt !== null,
        };
  // An archived or missing main conversation needs the server before it is usable here.
  const threadId =
    openedThreadId ?? (known !== null && (!known.archived || !opener.canStart) ? known.id : null);
  // A conversation already on this device stays readable offline; anything else needs its server.
  const unavailable =
    threadId !== null
      ? null
      : !connected
        ? "This environment isn’t connected. Reconnect it to talk to its Assistant."
        : !opener.canStart || opener.defaults === null
          ? (opener.reason ??
            "No model is available on this environment. Set up a provider to talk to your Assistant.")
          : null;

  // Opening this sheet is the user's request, so it may create or reopen the Assistant. A failed
  // attempt waits for Try again rather than repeating on its own.
  const requested = useRef(false);
  const [failed, setFailed] = useState(false);
  const { open, canStart, defaults } = opener;
  useEffect(() => {
    if (
      requested.current ||
      failed ||
      threadId !== null ||
      !connected ||
      !canStart ||
      defaults === null
    )
      return;
    requested.current = true;
    void open({ projectId: null, known, title: assistantName }).then((target) => {
      if (target) setOpenedThreadId(target.threadId);
      else {
        requested.current = false;
        setFailed(true);
      }
    });
  }, [open, connected, canStart, defaults, threadId, known, failed, assistantName]);

  const canSend = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const { messages, loading, error } = useRecentMessages(environmentId, threadId);
  // Kept per environment outside the sheet, so closing it mid-thought or mid-send loses nothing.
  const quick = useAssistantQuickState(environmentId);
  const sendDisabled = !canSend || threadId === null || quick.draft.trim().length === 0;
  const readView = useCurrentViewReader();

  const send = async () => {
    if (threadId === null || !canSend) return;
    const submitted = assistantQuickStore.beginSend(environmentId);
    if (submitted === null) return;
    // Read before the outbox stores the message, so a retry resends the screen it was written about.
    const currentView = await readView();
    const metadata = makeQueuedMessageMetadata();
    // Same outbox as the full composer; the conversation keeps its own model and modes.
    const outcome = await enqueueThreadOutboxMessage({
      environmentId,
      threadId,
      messageId: MessageId.make(metadata.messageId),
      commandId: CommandId.make(metadata.commandId),
      text: submitted.trim(),
      ...(currentView ? { context: { version: 1, records: [], currentView } } : {}),
      attachments: [],
      dispatchMode: "queue",
      createdAt: metadata.createdAt,
    }).then(
      () => ({ sent: true }) as const,
      (cause: unknown) =>
        ({
          sent: false,
          error: cause instanceof Error ? cause.message : "The message could not be saved.",
        }) as const,
    );
    assistantQuickStore.finishSend(environmentId, submitted, outcome);
  };

  const openFull = () => {
    if (threadId === null) return;
    showInBots({ environmentId, threadId });
  };

  const callsSupported =
    useEnvironmentServerConfig(environmentId)?.environment.capabilities.botVoice === true;
  const voiceAvailability = useBotCallAvailability({
    environmentId,
    projectId: project?.id ?? null,
    connected,
  });
  const callAvailability: BotCallAvailability =
    voiceAvailability.kind === "unavailable" || threadId !== null || failed
      ? voiceAvailability
      : { kind: "unavailable", reason: unavailable ?? "Your Assistant is still opening." };
  const activeCall = useBotCallSummary();
  const callThread = threadId === null ? null : { environmentId, threadId };
  const onThisCall =
    activeCall !== null && activeCall.phase !== "failed" && sameCallThread(activeCall, callThread);
  const callBot = project ? botCallBot(project) : ASSISTANT_BOT;
  // Only a Call tap may create or reopen the Assistant for a call, after a failed open here.
  const startCall = async ({ replacingCallId }: { readonly replacingCallId: string | null }) => {
    const callThreadId =
      threadId ?? (await open({ projectId: null, known, title: assistantName }))?.threadId ?? null;
    if (callThreadId === null) return;
    if (threadId === null) {
      setOpenedThreadId(callThreadId);
      setFailed(false);
    }
    startBotCall(
      { environmentId, bot: callBot, threadRef: { environmentId, threadId: callThreadId } },
      replacingCallId,
    );
  };
  const openVoiceSettings = () =>
    project
      ? openSettings(navigation, "SettingsVoiceBot", { environmentId, projectId: project.id })
      : openSettings(navigation, "SettingsVoiceDefault", { environmentId });

  const content = (
    <View
      className={cn("gap-3 px-4 pt-4", !CARD && "flex-1")}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <View className="flex-row items-center gap-2.5">
        <BotAvatar role="assistant" title={assistantName} size={28} project={project} />
        <View className="min-w-0 flex-1">
          <Text textRole="headline" className="font-t3-bold text-foreground" numberOfLines={1}>
            {assistantName}
          </Text>
          {environmentLabel ? (
            <Text textRole="caption" className="text-foreground-muted" numberOfLines={1}>
              {environmentLabel}
            </Text>
          ) : null}
        </View>
        {callsSupported && !onThisCall ? (
          <BotCallStartButton
            environmentId={environmentId}
            threadId={threadId}
            bot={callBot}
            active={activeCall}
            availability={callAvailability}
            onStart={(input) => void startCall(input)}
            // Unreachable: this conversation's call shows its bar instead of the button.
            onOpenActive={() => {}}
            onOpenSettings={openVoiceSettings}
          />
        ) : null}
        <Button
          tone="secondary"
          icon="arrow.up.right"
          label="Open"
          accessibilityLabel="Open the full Assistant chat in Bots"
          disabled={threadId === null}
          onPress={openFull}
        />
      </View>

      <View className={cn("justify-end gap-2", CARD ? "min-h-16" : "min-h-0 flex-1")}>
        {unavailable !== null ? (
          <Text textRole="footnote" className="text-center text-foreground-muted">
            {unavailable}
          </Text>
        ) : threadId === null && failed ? (
          <View className="items-center gap-3 py-2">
            <Text textRole="footnote" className="text-center text-foreground-muted">
              Your Assistant couldn’t be opened.
            </Text>
            <Button tone="secondary" label="Try again" onPress={() => setFailed(false)} />
          </View>
        ) : threadId === null || loading ? (
          <View className="items-center py-4">
            <AppActivityIndicator size="small" />
          </View>
        ) : error !== null ? (
          <Text textRole="footnote" className="text-center text-foreground-muted">
            {error}
          </Text>
        ) : messages.length === 0 ? (
          <Text textRole="footnote" className="text-center text-foreground-muted">
            Ask anything. The full conversation lives in Bots.
          </Text>
        ) : (
          messages.map((message) => (
            <View
              key={message.id}
              className={cn(
                "max-w-[88%] rounded-2xl",
                message.role === "user" ? "self-end bg-user-bubble px-3 py-2" : "self-start",
              )}
            >
              <Text
                textRole="footnote"
                className={
                  message.role === "user" ? "text-user-bubble-foreground" : "text-foreground"
                }
                numberOfLines={4}
              >
                {message.text}
              </Text>
            </View>
          ))
        )}
      </View>

      <ActiveBotCallBar thread={callThread} />
      {quick.error !== null ? (
        <Text
          textRole="footnote"
          className="text-danger-foreground"
          accessibilityLiveRegion="polite"
        >
          Message not sent. {quick.error}
        </Text>
      ) : null}
      <View className="flex-row items-end gap-2">
        <TextInput
          className="max-h-32 min-h-11 flex-1 rounded-3xl py-2.5"
          multiline
          value={quick.draft}
          onChangeText={(draft) => assistantQuickStore.setDraft(environmentId, draft)}
          editable={threadId !== null && canSend}
          placeholder={canSend ? "Ask Assistant…" : "Read-only access"}
          accessibilityLabel="Message Assistant"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: sendDisabled || quick.sending }}
          disabled={sendDisabled || quick.sending}
          onPress={send}
          className={cn(
            "size-11 items-center justify-center rounded-full bg-primary",
            sendDisabled && "opacity-40",
          )}
        >
          {quick.sending ? (
            <AppActivityIndicator size="small" />
          ) : (
            <SymbolView name="arrow.up" size={18} tintColorClassName="accent-primary-foreground" />
          )}
        </Pressable>
      </View>
    </View>
  );
  return <QuickSheetFrame onDismiss={() => navigation.goBack()}>{content}</QuickSheetFrame>;
}

// Android shows the sheet as a card over a transparent modal; iOS's formSheet is the card.
const CARD = Platform.OS === "android";

function QuickSheetFrame(props: { readonly onDismiss: () => void; readonly children: ReactNode }) {
  if (!CARD) {
    return (
      <View className="flex-1 bg-sheet">
        <KeyboardAvoidingView automaticOffset behavior="padding" className="flex-1">
          {props.children}
        </KeyboardAvoidingView>
      </View>
    );
  }
  return (
    <View className="flex-1 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close Assistant"
        onPress={props.onDismiss}
        className="absolute inset-0 bg-black/30"
      />
      <KeyboardAvoidingView behavior="padding">
        <View className="max-h-[560px] rounded-t-[28px] bg-sheet">{props.children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}
