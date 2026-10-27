import { VoiceCallSetupError } from "@t3tools/client-runtime/voice-call";
import { rtcStatsAudioLevels } from "@t3tools/client-runtime/voice-call/audio-levels";
import { openLiveMedia, type LiveMediaInput } from "@t3tools/client-runtime/voice-call/live-media";

import { callAudioLevels } from "./callAudioLevels";

/** Browser media stays on WebRTC; the environment receives only the SDP offer. */
export function openLiveWebRtc(input: LiveMediaInput) {
  return openLiveMedia(input, (events) => {
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events", { ordered: true });
    const playback = new Audio();
    playback.autoplay = true;
    playback.muted = input.playbackOnly !== true;
    let microphone: MediaStream | null = null;
    let microphoneEnabled = true;
    let stopped = false;
    let disposed = false;
    // Voice previews play outside any call, so only a call's own audio drives the call bar.
    const detachLevels =
      input.playbackOnly === true
        ? () => undefined
        : callAudioLevels.attach(() =>
            stopped
              ? null
              : peer.getStats().then((report) => {
                  const levels = rtcStatsAudioLevels(report);
                  return {
                    microphone: microphoneEnabled ? levels.microphone : 0,
                    speaker: playback.muted ? 0 : levels.speaker,
                  };
                }),
          );
    const stopAudio = () => {
      stopped = true;
      detachLevels();
      for (const track of microphone?.getTracks() ?? []) track.stop();
      playback.pause();
      playback.srcObject = null;
    };
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") events.receive(event.data);
    });
    channel.addEventListener("close", () => {
      if (!disposed) events.fail("The voice connection closed before finalization.");
    });
    channel.addEventListener("error", () => events.fail("The voice connection failed."));
    peer.addEventListener("connectionstatechange", () => {
      if (!disposed && (peer.connectionState === "failed" || peer.connectionState === "closed"))
        events.fail("The voice connection failed.");
    });
    peer.addEventListener("track", (event) => {
      if (stopped) return;
      playback.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void playback.play().catch(() => events.fail("Voice playback could not start."));
    });
    return {
      async offer() {
        if (input.playbackOnly) {
          peer.addTransceiver("audio", { direction: "recvonly" });
        } else {
          const captured = await navigator.mediaDevices
            .getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              video: false,
            })
            .catch(() => {
              throw new VoiceCallSetupError(
                "Microphone access failed. Allow microphone access for T3 Code in your browser and system settings, then try again.",
              );
            });
          if (stopped) {
            for (const track of captured.getTracks()) track.stop();
            throw new Error("The voice connection was cancelled.");
          }
          microphone = captured;
          for (const track of captured.getAudioTracks()) {
            track.addEventListener("ended", () => {
              if (!stopped) events.fail("Microphone access ended.");
            });
            peer.addTrack(track, captured);
          }
        }
        const offer = await peer.createOffer();
        if (stopped) throw new Error("The voice connection was cancelled.");
        await peer.setLocalDescription(offer);
        const sdp = peer.localDescription?.sdp;
        if (!sdp) throw new Error("The browser did not create a voice connection offer.");
        return sdp;
      },
      answer: (sdp) => peer.setRemoteDescription({ type: "answer", sdp }),
      send: (packet) => {
        if (channel.readyState !== "open") throw new Error("The voice data channel is closed.");
        channel.send(packet);
      },
      setPlaybackEnabled: (enabled) => {
        playback.muted = !enabled;
      },
      setMicrophoneEnabled: (enabled) => {
        microphoneEnabled = enabled;
        for (const track of microphone?.getAudioTracks() ?? []) track.enabled = enabled;
      },
      stopAudio,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        stopAudio();
        channel.close();
        peer.close();
      },
    };
  });
}
