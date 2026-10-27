import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { VoiceCallState } from "@t3tools/client-runtime/voice-call";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { useCurrentView } from "../../voice/currentView";
import { currentBrowserTarget, describeCurrentView } from "../../voice/currentView.shared";
import { voiceCallController, voiceViewContext } from "../../voice/runtime";
import { useVoiceCall } from "../../voice/useVoiceCall";
import { BotCallComposer, BotCallDock, BotCallTranscript } from "./BotCallDock";
import { endBotCall, toggleBotCallMute } from "./botCallActions";
import { botCallAnnouncement, type BotCallControls } from "./botCall.logic";
import { callBarSlotRef, useBotRoomStore } from "./botRoomStore";
import { useBotActions } from "./useBotActions";
import { useAppRoom } from "./useBotRoom";

/**
 * The one live call, visible and endable from every room and page. In the call's own chat it
 * sits inline above the composer; elsewhere it takes the floating Assistant's place above the
 * open chat's composer, or the corner when no chat is open. Must render inside the router.
 */
export function BotCallRoot() {
  const call = useVoiceCall();
  return (
    <>
      {/* Outside the dock, which remounts as it moves between slots, and mounted before any
          call, so screen readers hear the first status and never a repeat on a move. */}
      <div role="status" className="sr-only">
        {botCallAnnouncement(call)}
      </div>
      {call === null ? null : (
        <>
          <CallViewContextBridge />
          <BotCallDockHost call={call} />
        </>
      )}
    </>
  );
}

// Mounted only during a call, so describing the screen costs nothing otherwise. The bot reads
// the latest description when it needs one, and inspects the shown browser tab only on request;
// nothing here polls or reads page contents.
function CallViewContextBridge() {
  const { snapshot } = useCurrentView();
  // oxlint-disable-next-line t3code/react-effect-budget -- Publish the committed screen context to the independent voice session.
  useEffect(() => {
    voiceViewContext.set(
      snapshot === null ? null : describeCurrentView(snapshot),
      currentBrowserTarget(snapshot),
    );
  }, [snapshot]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Release screen context when this app host unmounts.
  useEffect(() => () => voiceViewContext.set(null), []);
  return null;
}

function BotCallDockHost({ call }: { call: VoiceCallState }) {
  const orbSlot = useBotRoomStore((state) => state.assistantOrbSlot);
  const callBarSlot = useBotRoomStore((state) => state.callBarSlot);
  const expanded = useBotRoomStore((state) => state.callTranscriptOpenFor === call.callId);
  const room = useAppRoom();
  // Route params keep naming the thread on screen until a navigation commits, so the dock moves
  // with the page rather than ahead of it.
  const routeRef = useThreadRouteRef();
  const callKey = scopedThreadKey(call.threadRef);
  const inline =
    room === "bots" &&
    routeRef !== null &&
    scopedThreadKey(routeRef) === callKey &&
    callBarSlot?.threadKey === callKey;
  const { openThread } = useBotActions();
  const setExpanded = (open: boolean) =>
    useBotRoomStore.getState().setCallTranscriptOpenFor(open ? call.callId : null);

  const controls: BotCallControls = {
    toggleMute: toggleBotCallMute,
    end: endBotCall,
    // The call's own thread reference, so a call always opens on the environment it runs on.
    openChat: (target) => {
      setExpanded(false);
      void openThread(target.threadRef, { fromCode: room === "code" });
    },
  };
  // Moving between slots remounts the dock; its transcript, draft, and drawer state live in the
  // runtime and store, so nothing is lost.
  const target = inline ? callBarSlot.element : orbSlot;
  const dock = (
    <div
      className={cn(
        "pointer-events-auto z-30",
        inline
          ? "relative"
          : orbSlot === null
            ? "fixed right-4 bottom-4"
            : "absolute right-0 bottom-0",
      )}
    >
      <BotCallDock
        call={call}
        controls={controls}
        inline={inline}
        expanded={expanded}
        onExpandedChange={setExpanded}
        transcript={<LiveCallTranscript callId={call.callId} />}
        composer={call.canSendText ? <LiveCallComposer callId={call.callId} /> : null}
      />
    </div>
  );
  return createPortal(dock, target ?? document.body);
}

/** Holds the call bar in a thread's own chat; empty and sizeless otherwise. */
export function BotCallBarSlot({ threadKey }: { threadKey: string }) {
  return <div ref={callBarSlotRef(threadKey)} className="flex flex-col pb-2 empty:hidden" />;
}

// These two subscribe only while the drawer shows them, so speech and typing never re-render
// the collapsed control.
function LiveCallTranscript({ callId }: { callId: string }) {
  const entries = useSyncExternalStore(voiceCallController.subscribeTranscript, () =>
    voiceCallController.getTranscript(callId),
  );
  return <BotCallTranscript entries={entries} />;
}

function LiveCallComposer({ callId }: { callId: string }) {
  const draft = useSyncExternalStore(voiceCallController.subscribeDraft, () =>
    voiceCallController.getDraft(callId),
  );
  return (
    <BotCallComposer
      draft={draft}
      onDraftChange={(text) => voiceCallController.setDraft(callId, text)}
      onSendDraft={() => void voiceCallController.sendDraft(callId)}
    />
  );
}
