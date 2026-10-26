import { createBotActivityContextAtom } from "@t3tools/client-runtime/voice-call/activity-context";
import { environmentProjects } from "../state/projects";
import { environmentPresentations } from "../state/presentation";
import { attachVoiceCallCues } from "@t3tools/client-runtime/voice-call/cues";
import { playCallCue } from "./callCues";
import { createEnvironmentVoiceRuntime } from "@t3tools/client-runtime/voice-call/environment-runtime";
import { createVoiceViewContext } from "@t3tools/client-runtime/voice-call/live-connector";

import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { botVoiceEnvironment } from "../state/botVoice";
import { environmentThreads, environmentThreadShells } from "../state/threads";
import { openLiveWebRtc } from "./liveWebRtc";
import { createBrowserPcmAudio } from "./pcmAudio";

export const voiceViewContext = createVoiceViewContext();
export const voiceCallController = createEnvironmentVoiceRuntime({
  registry: appAtomRegistry,
  activityContext: createBotActivityContextAtom({
    projects: environmentProjects.projectsAtom,
    threads: environmentThreadShells.quietThreadShellsAtom,
    presentations: environmentPresentations.presentationsAtom,
  }),
  commands: botVoiceEnvironment,
  endpointId: randomUUID(),
  createCallId: randomUUID,
  threadState: (ref) => environmentThreads.stateAtom(ref.environmentId, ref.threadId),
  openMedia: openLiveWebRtc,
  openPcmAudio: createBrowserPcmAudio,
  view: voiceViewContext,
});
const detachCues = attachVoiceCallCues(voiceCallController, playCallCue);

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
    detachCues();
    window.removeEventListener("pagehide", stopOnPageExit);
    const call = voiceCallController.getSnapshot();
    if (call !== null) void voiceCallController.end(call.callId, "interrupted");
  });
}
