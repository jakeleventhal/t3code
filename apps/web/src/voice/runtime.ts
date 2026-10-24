import { createEnvironmentVoiceRuntime } from "@t3tools/client-runtime/voice-call/environment-runtime";
import { createVoiceViewContext } from "@t3tools/client-runtime/voice-call/live-connector";

import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { botVoiceEnvironment } from "../state/botVoice";
import { environmentThreads } from "../state/threads";
import { openLiveWebRtc } from "./liveWebRtc";
import { createBrowserPcmAudio } from "./pcmAudio";

export const voiceViewContext = createVoiceViewContext();
export const voiceCallController = createEnvironmentVoiceRuntime({
  registry: appAtomRegistry,
  commands: botVoiceEnvironment,
  endpointId: randomUUID(),
  createCallId: randomUUID,
  threadState: (ref) => environmentThreads.stateAtom(ref.environmentId, ref.threadId),
  openMedia: openLiveWebRtc,
  openPcmAudio: createBrowserPcmAudio,
  view: voiceViewContext,
});

const stopOnPageExit = () => {
  const call = voiceCallController.getSnapshot();
  if (call !== null) void voiceCallController.end(call.callId, "interrupted");
};
voiceCallController.subscribe(() => {
  const call = voiceCallController.getSnapshot();
  if (call === null || call.phase === "failed")
    window.removeEventListener("pagehide", stopOnPageExit);
  else window.addEventListener("pagehide", stopOnPageExit);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", stopOnPageExit);
    const call = voiceCallController.getSnapshot();
    if (call !== null) void voiceCallController.end(call.callId, "interrupted");
  });
}
