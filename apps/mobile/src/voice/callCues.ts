// @effect-diagnostics globalTimers:off - Release a cue even if native playback never reports completion.
import { createAudioPlayer } from "expo-audio";

const connected = require("../../assets/sounds/call-connected.wav");
const ended = require("../../assets/sounds/call-ended.wav");

export function playCallCue(cue: "connected" | "ended") {
  const player = createAudioPlayer(cue === "connected" ? connected : ended);
  player.volume = 0.35;
  let disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    player.remove();
  };
  const timeout = setTimeout(release, 2000);
  player.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) release();
  });
  player.play();
}
