import type { VoiceCallResult, VoiceCallTarget } from "@t3tools/client-runtime/voice-call";

import { voiceCallController } from "../../voice/runtime";
import { stackedThreadToast, toastManager } from "../ui/toast";

function reportCallFailure(title: string, result: VoiceCallResult) {
  if (result.ok) return;
  toastManager.add(stackedThreadToast({ type: "error", title, description: result.error }));
}

/**
 * `replacingCallId` is the call the user saw and agreed to end; the runtime refuses if a
 * different one is live by now. A connection that fails stays on the call control with its
 * reason, so only refusals before that are reported here.
 */
export async function startBotCall(target: VoiceCallTarget, replacingCallId: string | null) {
  const result = await voiceCallController.start(
    target,
    replacingCallId === null ? {} : { replacingCallId },
  );
  const current = voiceCallController.getSnapshot();
  if (
    current?.phase === "failed" &&
    current.environmentId === target.environmentId &&
    current.threadRef.threadId === target.threadRef.threadId
  ) {
    return;
  }
  reportCallFailure("Couldn’t start the call", result);
}

export function toggleBotCallMute(callId: string) {
  void voiceCallController
    .toggleMute(callId)
    .then((result) => reportCallFailure("Couldn’t change the microphone", result));
}

export function endBotCall(callId: string) {
  void voiceCallController
    .end(callId)
    .then((result) => reportCallFailure("The call ended with a problem", result));
}
