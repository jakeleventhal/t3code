import { requireOptionalNativeModule } from "expo";
import { Asset } from "expo-asset";
import { createCallCuePlayer } from "./callCuePlayer";

const connected = require("../../assets/sounds/call-connected.wav");
const ended = require("../../assets/sounds/call-ended.wav");

export const playCallCue = createCallCuePlayer({
  load: async (cue) => {
    const asset = await Asset.fromModule(cue === "connected" ? connected : ended).downloadAsync();
    if (!asset.localUri) throw new Error("Call sound is unavailable.");
    return asset.localUri;
  },
  play: (uri, ended) => {
    // Expo Audio deactivates its session after playback, including a concurrent WebRTC call.
    requireOptionalNativeModule<{ playCue: (uri: string, ended: boolean) => void }>(
      "T3VoiceAudio",
    )?.playCue(uri, ended);
  },
});
