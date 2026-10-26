import { requireOptionalNativeModule } from "expo";
import { VoiceCallSetupError } from "@t3tools/client-runtime/voice-call";
import { openLiveMedia, type LiveMediaInput } from "@t3tools/client-runtime/voice-call/live-media";
import type { MediaStream, MediaStreamTrack } from "react-native-webrtc";

export async function openLiveNativeWebRtc(input: LiveMediaInput) {
  // Loading WebRTC installs native event listeners; ordinary text use should not pay that cost.
  const { RTCPeerConnection, mediaDevices } = await import("react-native-webrtc");
  const route = requireOptionalNativeModule<{
    preferSpeaker?: () => void;
    releaseWebRtcRoute?: () => void;
  }>("T3VoiceAudio");
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
      route?.releaseWebRtcRoute?.();
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
        if (input.playbackOnly) {
          peer.addTransceiver("audio", { direction: "recvonly" });
        } else {
          const captured = await mediaDevices
            .getUserMedia({ audio: true, video: false })
            .catch(() => {
              throw new VoiceCallSetupError(
                "Microphone access failed. Allow T3 Code microphone access in iPhone or Android Settings, then try the call again.",
              );
            });
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
        }
        route?.preferSpeaker?.();
        const offer = await peer.createOffer({});
        if (stopped) throw new Error("The voice connection was cancelled.");
        await peer.setLocalDescription(offer);
        const sdp = peer.localDescription?.sdp;
        if (!sdp) throw new Error("The device did not create a voice connection offer.");
        return sdp;
      },
      answer: async (sdp) => {
        await peer.setRemoteDescription({ type: "answer", sdp });
        if (!stopped) route?.preferSpeaker?.();
      },
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
