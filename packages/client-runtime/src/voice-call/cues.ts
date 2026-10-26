import type { VoiceCallController } from "./controller.ts";

/** One connected cue per call, not one per speech/listening or reconnect transition. */
export function attachVoiceCallCues(
  controller: Pick<VoiceCallController, "subscribe" | "getSnapshot">,
  play: (cue: "connected" | "ended") => void,
) {
  let connectedId: string | null = null;
  return controller.subscribe(() => {
    const call = controller.getSnapshot();
    if (
      connectedId !== null &&
      (call === null || call.callId !== connectedId || call.phase === "failed")
    ) {
      connectedId = null;
      play("ended");
    }
    if (
      call !== null &&
      connectedId !== call.callId &&
      ["listening", "thinking", "speaking"].includes(call.phase)
    ) {
      connectedId = call.callId;
      play("connected");
    }
  });
}
