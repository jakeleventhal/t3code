import { afterEach, expect, it, vi } from "vite-plus/test";

import { openLiveNativeWebRtc } from "./liveWebRtc";

const native = vi.hoisted(() => ({
  createPeer: vi.fn(),
  getUserMedia: vi.fn(),
  preferSpeaker: vi.fn(),
  reserveWebRtcRoute: vi.fn(),
  releaseWebRtcRoute: vi.fn(),
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));
vi.mock("react-native-webrtc", () => ({
  RTCPeerConnection: function MockPeer() {
    return native.createPeer();
  },
  mediaDevices: { getUserMedia: native.getUserMedia },
}));

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

class Track extends EventTarget {
  enabled = true;
}
class Channel extends EventTarget {
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
  const released = deferred<void>();
  const track = new Track();
  const stream = {
    getAudioTracks: () => [track],
    release: vi.fn(() => {
      track.enabled = false;
      released.resolve();
    }),
  };
  const channel = new Channel();
  const captureRequested = deferred<void>();
  const remoteApplied = deferred<void>();
  class Peer extends EventTarget {
    connectionState = "new";
    localDescription: { sdp: string } | null = null;
    createDataChannel = vi.fn(() => channel);
    addTrack = vi.fn();
    createOffer = vi.fn(async () => ({ type: "offer", sdp: "native-offer" }));
    setLocalDescription = vi.fn(async (offer: { sdp: string }) => {
      this.localDescription = offer;
    });
    setRemoteDescription = vi.fn(async () => {
      remoteApplied.resolve();
    });
    close = vi.fn(() => {
      this.connectionState = "closed";
    });
    receiveTrack(remote: Track) {
      this.dispatchEvent(Object.assign(new Event("track"), { track: remote }));
    }
  }
  const peer = new Peer();
  native.createPeer.mockReturnValue(peer);
  native.getUserMedia.mockImplementation(async () => {
    captureRequested.resolve();
    return stream;
  });
  const abort = new AbortController();
  const callbacks = {
    onTranscript: vi.fn(),
    onDelegation: vi.fn(),
    onClosed: vi.fn(),
    onFailure: vi.fn(),
  };
  const negotiate = vi.fn(async () => ({ sessionId: "native-live", sdp: "answer" }));
  const open = () => openLiveNativeWebRtc({ signal: abort.signal, negotiate, callbacks });
  const start = async () => {
    const pending = open();
    await remoteApplied.promise;
    channel.receive({ type: "session.started", session: { id: "native-live" } });
    return pending;
  };
  return {
    track,
    stream,
    peer,
    channel,
    abort,
    callbacks,
    negotiate,
    open,
    start,
    captureRequested,
    released,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

it("releases native capture and silences remote audio before draining final transcript", async () => {
  const f = fixture();
  const connection = await f.start();
  expect(native.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true, video: false });
  expect(native.preferSpeaker).toHaveBeenCalledTimes(2);
  expect(f.negotiate).toHaveBeenCalledExactlyOnceWith("native-offer", expect.any(AbortSignal));
  const remote = new Track();
  f.peer.receiveTrack(remote);
  f.abort.abort("user");
  expect(f.stream.release).toHaveBeenCalledOnce();
  expect(remote.enabled).toBe(false);
  expect(f.peer.close).not.toHaveBeenCalled();
  const lateRemote = new Track();
  f.peer.receiveTrack(lateRemote);
  expect(lateRemote.enabled).toBe(false);
  f.channel.receive({
    type: "session.input_transcript.delta",
    event_id: "final",
    delta: "bye",
    start_ms: 10,
    end_ms: 50,
  });
  expect(f.callbacks.onTranscript).toHaveBeenCalledWith({
    id: "final",
    speaker: "user",
    text: "bye",
    startMs: 10,
    endMs: 50,
  });
  const closed = connection.close();
  f.channel.receive({ type: "session.closed", reason: "close_requested" });
  await closed;
  expect(f.peer.close).toHaveBeenCalledOnce();
  expect(f.stream.release).toHaveBeenCalledOnce();
});

it("cancels a pending permission prompt and releases its late native stream", async () => {
  const f = fixture();
  const permission = deferred<typeof f.stream>();
  native.getUserMedia.mockImplementation(() => {
    f.captureRequested.resolve();
    return permission.promise;
  });
  const pending = f.open();
  await f.captureRequested.promise;
  expect(native.reserveWebRtcRoute).toHaveBeenCalledOnce();
  expect(native.reserveWebRtcRoute.mock.invocationCallOrder[0]).toBeLessThan(
    native.getUserMedia.mock.invocationCallOrder[0]!,
  );
  const routeId = native.reserveWebRtcRoute.mock.calls[0]![0];
  f.abort.abort();
  await expect(pending).rejects.toThrow("The voice connection was cancelled.");
  expect(native.releaseWebRtcRoute).toHaveBeenCalledWith(routeId);
  permission.resolve(f.stream);
  await f.released.promise;
  expect(f.stream.release).toHaveBeenCalledOnce();
  expect(f.negotiate).not.toHaveBeenCalled();
  expect(f.peer.close).toHaveBeenCalledOnce();
});

it("frees the native microphone when provider negotiation fails", async () => {
  const f = fixture();
  f.negotiate.mockRejectedValue(new Error("provider rejected"));
  await expect(f.open()).rejects.toThrow("Could not establish");
  expect(f.stream.release).toHaveBeenCalledOnce();
  expect(f.peer.close).toHaveBeenCalledOnce();
  expect(f.callbacks.onFailure).toHaveBeenCalledOnce();
});

it("keeps capture muted until the provider accepts unmute", async () => {
  const f = fixture();
  const connection = await f.start();
  const muted = connection.setMuted(true);
  expect(f.track.enabled).toBe(false);
  f.channel.receive({
    type: "session.input_audio.muted",
    client_event_id: f.channel.packets.at(-1)!.event_id,
  });
  await muted;
  const unmuted = connection.setMuted(false);
  expect(f.track.enabled).toBe(false);
  f.channel.receive({
    type: "session.input_audio.unmuted",
    client_event_id: f.channel.packets.at(-1)!.event_id,
  });
  await unmuted;
  expect(f.track.enabled).toBe(true);
  const closed = connection.close();
  f.channel.receive({ type: "session.closed", reason: "close_requested" });
  await closed;
});
