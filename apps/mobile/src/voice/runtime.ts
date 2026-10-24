import { createEnvironmentVoiceRuntime } from "@t3tools/client-runtime/voice-call/environment-runtime";
import { createVoiceViewContext } from "@t3tools/client-runtime/voice-call/live-connector";
import { AppState } from "react-native";

import { uuidv4 } from "../lib/uuid";
import {
  disposeOnFoundationReplace,
  type FoundationHotModule,
} from "../lib/foundation-fast-refresh";
import { appAtomRegistry } from "../state/atom-registry";
import { botVoiceEnvironment } from "../state/bot-voice";
import { environmentThreads } from "../state/threads";
import { openLiveNativeWebRtc } from "./liveWebRtc";
import { createNativePcmAudio } from "./pcmAudio";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

export const voiceViewContext = createVoiceViewContext();
export const voiceCallController = createEnvironmentVoiceRuntime({
  registry: appAtomRegistry,
  commands: botVoiceEnvironment,
  endpointId: uuidv4(),
  createCallId: uuidv4,
  threadState: (ref) => environmentThreads.stateAtom(ref.environmentId, ref.threadId),
  openMedia: openLiveNativeWebRtc,
  openPcmAudio: createNativePcmAudio,
  view: voiceViewContext,
});

let backgroundListener: ReturnType<typeof AppState.addEventListener> | null = null;
const detachLifecycle = voiceCallController.subscribe(() => {
  const call = voiceCallController.getSnapshot();
  if (call === null || call.phase === "failed") {
    backgroundListener?.remove();
    backgroundListener = null;
  } else if (backgroundListener === null) {
    backgroundListener = AppState.addEventListener("change", (state) => {
      // Inactive includes the microphone permission sheet. Background alone
      // means this client can no longer keep its audio and transcript synchronized.
      if (state !== "background") return;
      const active = voiceCallController.getSnapshot();
      if (active !== null) void voiceCallController.end(active.callId, "interrupted");
    });
  }
});

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, async () => {
  detachLifecycle();
  backgroundListener?.remove();
  backgroundListener = null;
  const call = voiceCallController.getSnapshot();
  if (call !== null) await voiceCallController.end(call.callId, "interrupted");
});
