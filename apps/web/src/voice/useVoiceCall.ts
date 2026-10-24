import { useSyncExternalStore } from "react";

import { voiceCallController } from "./runtime";

/** The one call app-wide. Changes on phase, mute, and errors; never on speech or typing. */
export function useVoiceCall() {
  return useSyncExternalStore(voiceCallController.subscribe, voiceCallController.getSnapshot);
}

const hasCall = () => voiceCallController.getSnapshot() !== null;

/** For surfaces that only care whether a call is up, so phase changes don't re-render them. */
export function useHasVoiceCall() {
  return useSyncExternalStore(voiceCallController.subscribe, hasCall);
}
