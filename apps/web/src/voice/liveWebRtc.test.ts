import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { VoiceCallSetupError } from "@t3tools/client-runtime/voice-call";

import { openLiveWebRtc } from "./liveWebRtc";

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

class FakeTrack extends EventTarget {
  enabled = true;
  stop = vi.fn();
}

class FakeChannel extends EventTarget {
  readyState = "open";
  packets: Array<Record<string, unknown>> = [];
  send(packet: string) {
    this.packets.push(JSON.parse(packet));
  }
  close = vi.fn(() => {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  });
  receive(packet: object) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) }));
  }
}

function fixture() {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = new FakeChannel();
  const remoteApplied = deferred<void>();
  const offerMade = deferred<void>();
  class FakePeer extends EventTarget {
    connectionState = "new";
    localDescription: { sdp: string } | null = null;
    createDataChannel = vi.fn(() => channel);
    addTrack = vi.fn();
    addTransceiver = vi.fn();
    createOffer = vi.fn(async () => {
      offerMade.resolve();
      return { type: "offer", sdp: "local-sdp" };
    });
    setLocalDescription = vi.fn(async (offer: { sdp: string }) => {
      this.localDescription = offer;
    });
    setRemoteDescription = vi.fn(async () => {
      remoteApplied.resolve();
    });
    close = vi.fn(() => {
      this.connectionState = "closed";
      this.dispatchEvent(new Event("connectionstatechange"));
    });
  }
  const peer = new FakePeer();
  const playback = {
    autoplay: false,
    srcObject: null,
    pause: vi.fn(),
    play: vi.fn(async () => {}),
  };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("RTCPeerConnection", function FakePeerConstructor() {
    return peer;
  });
  vi.stubGlobal("Audio", function FakeAudioConstructor() {
    return playback;
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const abort = new AbortController();
  const callbacks = {
    onTranscript: vi.fn(),
    onDelegation: vi.fn(),
    onClosed: vi.fn(),
    onFailure: vi.fn(),
  };
  const negotiate = vi.fn(async () => ({ sessionId: "live-1", sdp: "remote-sdp" }));
  const open = () => openLiveWebRtc({ signal: abort.signal, negotiate, callbacks });
  const start = async () => {
    const pending = open();
    await remoteApplied.promise;
    channel.receive({ type: "session.started", session: { id: "live-1" } });
    return pending;
  };
  const finish = async (connection: Awaited<ReturnType<typeof openLiveWebRtc>>) => {
    const closed = connection.close();
    channel.receive({ type: "session.closed", reason: "close_requested" });
    await closed;
  };
  return {
    track,
    stream,
    channel,
    peer,
    playback,
    getUserMedia,
    abort,
    callbacks,
    negotiate,
    remoteApplied,
    offerMade,
    open,
    start,
    finish,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser Live media lifecycle", () => {
  it("negotiates only SDP, waits for provider readiness, and never creates a recorder", async () => {
    const f = fixture();
    const recorder = vi.fn(() => {
      throw new Error("Audio must not be recorded");
    });
    vi.stubGlobal("MediaRecorder", recorder);
    const connection = await f.start();
    expect(f.negotiate).toHaveBeenCalledExactlyOnceWith("local-sdp", expect.any(AbortSignal));
    expect(f.peer.setRemoteDescription).toHaveBeenCalledExactlyOnceWith({
      type: "answer",
      sdp: "remote-sdp",
    });
    expect(f.channel.packets).toEqual([]);
    expect(recorder).not.toHaveBeenCalled();
    await f.finish(connection);
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.peer.close).toHaveBeenCalledOnce();
  });

  it("ends immediately while microphone permission is pending and stops a late permission grant", async () => {
    const f = fixture();
    const permission = deferred<typeof f.stream>();
    const released = deferred<void>();
    f.track.stop.mockImplementation(() => released.resolve());
    f.getUserMedia.mockImplementation(() => permission.promise);
    const pending = f.open();
    f.abort.abort();
    await expect(pending).rejects.toThrow("The voice connection was cancelled.");
    expect(f.peer.close).toHaveBeenCalledOnce();
    permission.resolve(f.stream);
    await released.promise;
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.negotiate).not.toHaveBeenCalled();
  });

  it("aborts negotiation and never applies a late SDP after hang-up", async () => {
    const f = fixture();
    const negotiationStarted = deferred<AbortSignal>();
    const answer = deferred<{ sessionId: string; sdp: string }>();
    const pending = openLiveWebRtc({
      signal: f.abort.signal,
      callbacks: f.callbacks,
      negotiate: (_sdp, signal) => {
        negotiationStarted.resolve(signal);
        return answer.promise;
      },
    });
    const signal = await negotiationStarted.promise;
    f.abort.abort();
    await expect(pending).rejects.toThrow("The voice connection was cancelled.");
    expect(signal.aborted).toBe(true);
    expect(f.track.stop).toHaveBeenCalled();
    answer.resolve({ sessionId: "late", sdp: "too-late" });
    await Promise.resolve();
    expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("stops local audio immediately but drains the transcript before closing the peer", async () => {
    const f = fixture();
    const connection = await f.start();
    f.abort.abort();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.playback.pause).toHaveBeenCalled();
    expect(f.peer.close).not.toHaveBeenCalled();
    f.channel.receive({
      type: "session.output_transcript.delta",
      event_id: "last",
      delta: "Bye",
      start_ms: 0,
      end_ms: 10,
    });
    expect(f.callbacks.onTranscript).toHaveBeenCalledOnce();
    f.channel.receive({ type: "session.closed", reason: "close_requested" });
    await connection.close();
    expect(f.peer.close).toHaveBeenCalledOnce();
    expect(f.callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("keeps local capture muted until the provider acknowledges unmute", async () => {
    const f = fixture();
    const connection = await f.start();
    const mute = connection.setMuted(true);
    expect(f.track.enabled).toBe(false);
    f.channel.receive({
      type: "session.input_audio.muted",
      client_event_id: f.channel.packets.at(-1)!.event_id,
    });
    await mute;
    const unmute = connection.setMuted(false);
    expect(f.track.enabled).toBe(false);
    f.channel.receive({
      type: "session.input_audio.unmuted",
      client_event_id: f.channel.packets.at(-1)!.event_id,
    });
    await unmute;
    expect(f.track.enabled).toBe(true);
    await f.finish(connection);
  });

  it("releases the microphone when provider readiness never arrives", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.open();
    const failure = expect(pending).rejects.toThrow("The voice connection timed out.");
    await f.remoteApplied.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.peer.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an answer for a different provider session and releases media", async () => {
    const f = fixture();
    const pending = f.open();
    await f.remoteApplied.promise;
    f.channel.receive({ type: "session.started", session: { id: "different-session" } });
    await expect(pending).rejects.toThrow("Could not establish");
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.peer.close).toHaveBeenCalledOnce();
  });

  it("releases capture when authentication fails without retrying the provider", async () => {
    const f = fixture();
    f.negotiate.mockRejectedValue(new Error("Credentials refused"));
    await expect(f.open()).rejects.toThrow("Could not establish");
    expect(f.negotiate).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.peer.close).toHaveBeenCalledOnce();
    expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("preserves a safe application error while releasing a refused connection", async () => {
    const f = fixture();
    f.negotiate.mockRejectedValue(
      new VoiceCallSetupError("The voice provider did not accept these credentials."),
    );
    await expect(f.open()).rejects.toThrow("did not accept these credentials");
    expect(f.callbacks.onFailure).toHaveBeenCalledExactlyOnceWith(
      "The voice provider did not accept these credentials.",
    );
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.peer.close).toHaveBeenCalledOnce();
  });

  it("ends the call if unmute is refused instead of reporting a microphone state it cannot confirm", async () => {
    const f = fixture();
    const connection = await f.start();
    const mute = connection.setMuted(true);
    f.channel.receive({
      type: "session.input_audio.muted",
      client_event_id: f.channel.packets.at(-1)!.event_id,
    });
    await mute;
    const unmute = connection.setMuted(false);
    f.channel.receive({
      type: "error",
      error: { client_event_id: f.channel.packets.at(-1)!.event_id },
    });
    await expect(unmute).rejects.toThrow("did not accept");
    expect(f.track.enabled).toBe(false);
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.peer.close).toHaveBeenCalledOnce();
    expect(f.callbacks.onFailure).toHaveBeenCalledExactlyOnceWith(
      "The microphone change could not be confirmed.",
    );
  });
});

it("voice previews receive audio without requesting microphone access", async () => {
  const f = fixture();
  const pending = openLiveWebRtc({
    signal: f.abort.signal,
    negotiate: f.negotiate,
    callbacks: f.callbacks,
    playbackOnly: true,
  });
  await f.remoteApplied.promise;
  f.channel.receive({ type: "session.started", session: { id: "live-1" } });
  const media = await pending;
  expect(f.getUserMedia).not.toHaveBeenCalled();
  expect(f.peer.addTrack).not.toHaveBeenCalled();
  expect(f.peer.addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
  await f.finish(media);
  expect(f.peer.close).toHaveBeenCalledOnce();
});
