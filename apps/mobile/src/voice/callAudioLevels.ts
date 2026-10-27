import { createCallAudioLevelMeter } from "@t3tools/client-runtime/voice-call/audio-levels";

/** The live call's measured loudness. Its media attaches a source; the call bar listens. */
export const callAudioLevels = createCallAudioLevelMeter();
