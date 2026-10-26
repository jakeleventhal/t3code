import { isSettingsRoute } from "../settings/settings-navigation";
import { useCompactWorkspaceTabs } from "../workspace/useSystemWorkspaceTabBar";
import { workspaceDockBottomClearance } from "../workspace/workspace-tabs-state";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import type { VoiceCallTarget } from "@t3tools/client-runtime/voice-call";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useIsFocused } from "@react-navigation/native";
import { use, useEffect, useState, type ReactNode } from "react";
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
import { useShowConversationInBots } from "./use-assistant";
import { useActiveBotCall, useBotCallSummary } from "./use-bot-call";

export function ActiveBotCallBar(props: {
  readonly thread: ScopedThreadRef | null;
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const call = useActiveBotCall();
  const showInBots = useShowConversationInBots();
  if (call === null) return null;
  const controls: BotCallControls = {
    toggleMute: (callId) =>
      void voiceCallController.toggleMute(callId).then((result) => {
        if (!result.ok) Dialog.alert("Microphone unchanged", result.error);
      }),
    end: (callId) => {
      void voiceCallController.end(callId).then((result) => {
        if (!result.ok) Dialog.alert("Call ended", result.error);
      });
    },
    openChat: (target: VoiceCallTarget) => {
      showInBots({
        environmentId: target.threadRef.environmentId,
        threadId: target.threadRef.threadId,
      });
    },
  };
  return (
    <View pointerEvents="box-none" className={props.className} style={props.style}>
      <BotCallBar call={call} controls={controls} />
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
  // oxlint-disable-next-line t3code/react-effect-budget -- Publish the committed visible screen to the external voice session.
  useEffect(() => {
    viewOwner = owner;
    voiceViewContext.set(
      snapshot === null ? null : describeCurrentView(snapshot),
      currentBrowserTarget(snapshot),
    );
  }, [owner, snapshot]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Release this screen's voice context when it unmounts.
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
  const bottomClearance = useWorkspaceTabs()?.bottomClearance ?? 0;
  const compactTabs = useCompactWorkspaceTabs();
  const dockClearance =
    compactTabs && isSettingsRoute(props.routeName)
      ? workspaceDockBottomClearance({ bottomInset: insets.bottom, keyboardHeight: 0 })
      : 0;
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
          style={{ paddingBottom: Math.max(insets.bottom, bottomClearance, dockClearance, 8) }}
        />
      ) : null}
      {live && owner ? <CurrentViewBridge /> : null}
    </>
  );
}
