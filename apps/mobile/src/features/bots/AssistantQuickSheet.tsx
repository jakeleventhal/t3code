import { openSettings } from "../settings/settings-navigation";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  EnvironmentId,
  MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
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
import { useEnvironmentThread, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
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
import { botChatTurn } from "./bot-turn-settings";
import { useOpenBotConversation } from "./use-bot-conversation";

const ASSISTANT_BOT = { id: "assistant", title: "Assistant", botRole: "assistant" } as const;

const PREVIEW_MESSAGES = 24;

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
  const { nativeTextStyle } = useMarkdownPreviewStyles();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const pinned = useRef(true);
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, "stop Assistant");
  const insets = useSafeAreaInsets();
  const showInBots = useShowConversationInBots();
  const environments = useWorkspaceEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  // Over Code, the work on screen may be on another environment, so the host is named only
  // when it explains why the Assistant can't answer.
  const host = environment?.environmentLabel ?? "Your Assistant’s environment";
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
        ? `${host} isn’t connected. Reconnect it to talk to your Assistant.`
        : !opener.canStart || opener.defaults === null
          ? (opener.reason ??
            `No model is available on ${host}. Set up a provider there to talk to your Assistant.`)
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
  const serverConfig = useEnvironmentServerConfig(environmentId);
  // A model chosen in the Assistant's settings or the bot defaults rides on each message; one
  // that can't run here holds the send instead of quietly using the conversation's own.
  const botTurn =
    mainThread !== null && mainThread.id === threadId
      ? botChatTurn({
          config: serverConfig,
          project,
          fallback: {
            modelSelection: mainThread.modelSelection,
            runtimeMode: mainThread.runtimeMode,
          },
        })
      : null;
  const setupNeeded = connected && botTurn?.kind === "setup-needed" ? botTurn.reason : null;
  const sendDisabled =
    !canSend || threadId === null || setupNeeded !== null || quick.draft.trim().length === 0;
  const readView = useCurrentViewReader();
  const working = connected && threadRuntimeIsActive(mainThread?.runtime);
  const needsYou =
    connected && (mainThread?.hasPendingApprovals || mainThread?.hasPendingUserInput);
  const replyFailed = connected && mainThread?.latestRun?.status === "failed";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  const startedAt = mainThread?.runtime?.activityStartedAt;
  const elapsed = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0;

  const send = async () => {
    if (threadId === null || !canSend || setupNeeded !== null) return;
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
      ...(botTurn
        ? { modelSelection: botTurn.modelSelection, runtimeMode: botTurn.runtimeMode }
        : {}),
      dispatchMode: "auto",
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

  const callsSupported = serverConfig?.environment.capabilities.botVoice === true;
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
      className={"flex-1 gap-3 px-4 pt-4"}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <View className="flex-row items-center gap-2.5">
        <BotAvatar role="assistant" title={assistantName} size={28} project={project} />
        <View className="min-w-0 flex-1">
          <Text textRole="headline" className="font-t3-bold text-foreground" numberOfLines={1}>
            {assistantName}
          </Text>
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

      <ScrollView
        ref={scroll}
        className="min-h-0 flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", gap: 8 }}
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: e }) => {
          pinned.current =
            e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 24;
        }}
        onContentSizeChange={() => {
          if (pinned.current) scroll.current?.scrollToEnd({ animated: false });
        }}
      >
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
              {message.role === "assistant" ? (
                <SelectableMarkdownText markdown={message.text} textStyle={nativeTextStyle} />
              ) : (
                <Text textRole="footnote" className="text-user-bubble-foreground" selectable>
                  {message.text}
                </Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
      {needsYou ? (
        <Text
          textRole="footnote"
          className="text-foreground-muted"
          accessibilityLiveRegion="polite"
        >
          Assistant needs your answer or approval. Open the full conversation to respond.
        </Text>
      ) : working ? (
        <View className="flex-row items-center gap-2" accessibilityLiveRegion="polite">
          <Text textRole="footnote" className="flex-1 text-foreground-muted">
            {`${mainThread?.runtime?.status === "preparing" || mainThread?.runtime?.status === "starting" ? "Assistant is starting" : "Assistant is working"} · ${elapsed}s`}
          </Text>
          <Button
            tone="secondary"
            label="Stop"
            onPress={() => {
              if (threadId) void interrupt({ environmentId, input: { threadId } });
            }}
          />
        </View>
      ) : replyFailed ? (
        <Text textRole="footnote" className="text-danger-foreground">
          {`Assistant could not finish the reply. ${mainThread?.runtime?.lastError ?? "Open the conversation for details, then send a message to try again."}`}
        </Text>
      ) : quick.sending ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Sending your message…
        </Text>
      ) : !connected ? (
        <Text textRole="footnote" className="text-foreground-muted">
          {`${host} is disconnected. Messages wait on this device and send when it reconnects.`}
        </Text>
      ) : null}

      <ActiveBotCallBar thread={callThread} />
      {setupNeeded !== null ? (
        <View className="items-start gap-1">
          <Text textRole="footnote" className="text-foreground-muted">
            {`Setup needed · ${setupNeeded}`}
          </Text>
          <Button
            tone="text"
            label="Bot settings"
            onPress={() =>
              navigation.navigate("SettingsSheet", {
                screen: "SettingsContent",
                params: {
                  screen: "SettingsBotTurn",
                  params: { environmentId, ...(project ? { projectId: project.id } : {}) },
                },
              })
            }
          />
        </View>
      ) : null}
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
        <View className="h-[560px] max-h-full rounded-t-[28px] bg-sheet">{props.children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}
