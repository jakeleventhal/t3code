import connected from "../assets/call-connected.wav?url";
import ended from "../assets/call-ended.wav?url";

export function playCallCue(cue: "connected" | "ended") {
  const audio = new Audio(cue === "connected" ? connected : ended);
  audio.volume = 0.35;
  void audio.play().catch(() => undefined);
}
