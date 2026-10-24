import type { VoiceCallTarget } from "@t3tools/client-runtime/voice-call";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useIsFocused } from "@react-navigation/native";
import { use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import * as Dialog from "../../components/ui/Dialog";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { useCurrentView } from "../../voice/current-view";
import { currentBrowserTarget, describeCurrentView } from "../../voice/current-view.shared";
import { voiceCallController, voiceViewContext } from "../../voice/runtime";
import type { BotCallControls } from "./bot-call";
import { BotCallBar } from "./BotCallBar";
import { BotCallComposer, BotCallTranscript } from "./BotCallTranscriptSheet";
import { useShowConversationInBots } from "./use-assistant";
import { sameCallThread, useActiveBotCall, useBotCallSummary } from "./use-bot-call";

function LiveCallTranscript(props: { readonly callId: string }) {
  const entries = useSyncExternalStore(voiceCallController.subscribeTranscript, () =>
    voiceCallController.getTranscript(props.callId),
  );
  return <BotCallTranscript entries={entries} />;
}

function LiveCallComposer(props: { readonly callId: string }) {
  const { callId } = props;
  const draft = useSyncExternalStore(voiceCallController.subscribeDraft, () =>
    voiceCallController.getDraft(callId),
  );
  return (
    <BotCallComposer
      draft={draft}
      onDraftChange={(text) => voiceCallController.setDraft(callId, text)}
      // A failed send lands in the draft's own error line.
      onSendDraft={() => void voiceCallController.sendDraft(callId)}
    />
  );
}

/**
 * The one live call, wherever the user is. `thread` is the conversation this surface shows: on
 * the call's own conversation, Open chat just closes the transcript. Renders nothing between
 * calls, so callers can mount it unconditionally.
 */
export function ActiveBotCallBar(props: {
  readonly thread: ScopedThreadRef | null;
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const call = useActiveBotCall();
  const showInBots = useShowConversationInBots();
  // Keyed to the call, so the next call never opens with an earlier call's transcript showing.
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const { thread } = props;
  if (call === null) return null;
  const setExpanded = (expanded: boolean) => setExpandedCallId(expanded ? call.callId : null);
  const controls: BotCallControls = {
    toggleMute: (callId) =>
      void voiceCallController.toggleMute(callId).then((result) => {
        if (!result.ok) Dialog.alert("Microphone unchanged", result.error);
      }),
    end: (callId) => {
      setExpanded(false);
      void voiceCallController.end(callId).then((result) => {
        if (!result.ok) Dialog.alert("Call ended", result.error);
      });
    },
    openChat: (target: VoiceCallTarget) => {
      setExpanded(false);
      if (sameCallThread(target, thread)) return;
      showInBots({
        environmentId: target.threadRef.environmentId,
        threadId: target.threadRef.threadId,
      });
    },
  };
  return (
    <View pointerEvents="box-none" className={props.className} style={props.style}>
      <BotCallBar
        call={call}
        controls={controls}
        expanded={expandedCallId === call.callId}
        onExpandedChange={setExpanded}
        transcript={<LiveCallTranscript callId={call.callId} />}
        composer={call.canSendText ? <LiveCallComposer callId={call.callId} /> : null}
      />
    </View>
  );
}

// Retained room tabs and focus handoffs can briefly hold two bridges; only the latest writer may
// clear the view.
let viewOwner: symbol | null = null;

/**
 * Tells the live call what this device shows: route metadata and the browser tab on screen, never
 * page contents. Must render inside a root stack screen.
 */
function CurrentViewBridge() {
  const { snapshot } = useCurrentView();
  const [owner] = useState(() => Symbol("current-view"));
  useEffect(() => {
    viewOwner = owner;
    voiceViewContext.set(
      snapshot === null ? null : describeCurrentView(snapshot),
      currentBrowserTarget(snapshot),
    );
  }, [owner, snapshot]);
  useEffect(
    () => () => {
      if (viewOwner !== owner) return;
      viewOwner = null;
      voiceViewContext.set(null);
    },
    [owner],
  );
  return null;
}

/** Root screens that place the call bar themselves, beside their own composer or controls. */
const OWN_CALL_BAR_ROUTES: ReadonlySet<string> = new Set(["Home", "Thread", "AssistantQuick"]);

/**
 * The live call on every root screen, so it can be muted or ended over a pull request, a browser,
 * or a sheet without going back. Screens without their own spot get the bar as a footer that the page
 * shrinks to clear, and the focused screen alone reads what this device shows. A covered screen
 * keeps its bar so nothing jumps on return; the native presentation keeps it out of reach.
 */
export function ActiveCallScreenSlot(props: {
  readonly routeName: string;
  readonly children: ReactNode;
}) {
  const live = useBotCallSummary() !== null;
  // A retained room tab renders the same root page again, so it must not read the view too.
  const owner = useIsFocused() && (use(NativeWorkspaceTabActivityContext)?.active ?? true);
  // Under the keyboard the footer is hidden anyway, and the page gets its full height back for
  // composers that lift by the keyboard's height.
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const insets = useSafeAreaInsets();
  const footer = live && !keyboardVisible && !OWN_CALL_BAR_ROUTES.has(props.routeName);
  return (
    <>
      <SafeAreaInsetsContext value={footer ? { ...insets, bottom: 0 } : insets}>
        {props.children}
      </SafeAreaInsetsContext>
      {footer ? (
        <ActiveBotCallBar
          thread={null}
          className="w-full max-w-2xl self-center px-4 pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        />
      ) : null}
      {live && owner ? <CurrentViewBridge /> : null}
    </>
  );
}
