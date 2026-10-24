import { openLiveMedia, type LiveMediaInput } from "@t3tools/client-runtime/voice-call/live-media";
import type { MediaStream, MediaStreamTrack } from "react-native-webrtc";

export async function openLiveNativeWebRtc(input: LiveMediaInput) {
  // Loading WebRTC installs native event listeners; ordinary text use should not pay that cost.
  const { RTCPeerConnection, mediaDevices } = await import("react-native-webrtc");
  return openLiveMedia(input, (events) => {
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events", { ordered: true });
    let microphone: MediaStream | null = null;
    const remoteTracks = new Set<MediaStreamTrack>();
    let stopped = false;
    let disposed = false;
    const stopAudio = () => {
      stopped = true;
      // Native track.stop only disables the source. release frees microphone capture.
      microphone?.release();
      microphone = null;
      for (const track of remoteTracks) track.enabled = false;
      remoteTracks.clear();
    };
    channel.addEventListener("message", (event) => {
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
      if (event.track === null) return;
      // Native WebRTC plays remote audio automatically, including tracks delivered during teardown.
      if (stopped) event.track.enabled = false;
      else remoteTracks.add(event.track);
    });
    return {
      async offer() {
        const captured = await mediaDevices.getUserMedia({ audio: true, video: false });
        if (stopped) {
          captured.release();
          throw new Error("The voice connection was cancelled.");
        }
        microphone = captured;
        for (const track of captured.getAudioTracks()) {
          track.addEventListener("ended", () => {
            if (!stopped) events.fail("Microphone access ended.");
          });
          peer.addTrack(track, captured);
        }
        const offer = await peer.createOffer({});
        if (stopped) throw new Error("The voice connection was cancelled.");
        await peer.setLocalDescription(offer);
        const sdp = peer.localDescription?.sdp;
        if (!sdp) throw new Error("The device did not create a voice connection offer.");
        return sdp;
      },
      answer: (sdp) => peer.setRemoteDescription({ type: "answer", sdp }),
      send: (packet) => {
        if (channel.readyState !== "open") throw new Error("The voice data channel is closed.");
        channel.send(packet);
      },
      setMicrophoneEnabled: (enabled) => {
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
