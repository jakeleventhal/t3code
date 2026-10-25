// @effect-diagnostics globalTimers:off - This client-owned deadline bounds microphone permission and provider setup.
import { LiveSession } from "./live-session.ts";
import { VoiceCallSetupError } from "./controller.ts";

export interface LiveMediaTransport {
  readonly offer: () => Promise<string>;
  readonly answer: (sdp: string) => Promise<void>;
  readonly send: (packet: string) => void;
  readonly setMicrophoneEnabled: (enabled: boolean) => void;
  readonly stopAudio: () => void;
  readonly dispose: () => void;
}

export interface LiveMediaInput {
  readonly playbackOnly?: boolean;
  readonly signal: AbortSignal;
  readonly negotiate: (
    sdp: string,
    signal: AbortSignal,
  ) => Promise<{
    readonly sessionId: string;
    readonly sdp: string;
    readonly protocol?: "codex" | undefined;
  }>;
  readonly callbacks: ConstructorParameters<typeof LiveSession>[0]["callbacks"];
}

/** Both clients stop audio immediately, then drain the same provider control protocol. */
export async function openLiveMedia(
  input: LiveMediaInput,
  createMedia: (events: {
    readonly receive: (packet: string) => void;
    readonly fail: (message: string) => void;
  }) => LiveMediaTransport,
) {
  input.signal.throwIfAborted();
  let media: LiveMediaTransport | undefined;
  let disposed = false;
  let ready = false;
  let closing: Promise<void> | null = null;
  const setupAbort = new AbortController();
  let rejectSetup!: (reason: Error) => void;
  const setupFailure = new Promise<never>((_resolve, reject) => {
    rejectSetup = reject;
  });
  void setupFailure.catch(() => undefined);
  let commandOrdinal = 0;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    setupAbort.abort();
    input.signal.removeEventListener("abort", abort);
    media?.dispose();
  };
  const session = new LiveSession({
    createEventId: () => `t3-live-${++commandOrdinal}`,
    send: (packet) => {
      if (media === undefined) throw new Error("The voice transport is not ready.");
      media.send(packet);
    },
    callbacks: {
      ...input.callbacks,
      onClosed: (reason) => {
        if (!ready)
          rejectSetup(
            new VoiceCallSetupError(
              "The voice provider closed the connection during setup. Try again or choose another voice account.",
            ),
          );
        cleanup();
        input.callbacks.onClosed(reason);
      },
      onFailure: (message) => {
        rejectSetup(new VoiceCallSetupError(message));
        cleanup();
        input.callbacks.onFailure(message);
      },
    },
  });
  const close = (): Promise<void> => {
    media?.stopAudio();
    closing ??= session.close().finally(cleanup);
    return closing;
  };
  function abort() {
    media?.stopAudio();
    if (ready) void close().catch(() => undefined);
    else session.fail("The voice connection was cancelled.");
  }
  input.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => session.fail("The voice connection timed out."), 30_000);
  try {
    media = createMedia({
      receive: (packet) => session.receive(packet),
      fail: (message) => {
        if (!disposed) session.fail(message);
      },
    });
    const transport = media;
    const setup = async () => {
      const sdp = await transport.offer();
      if (disposed) throw new Error("The voice connection was cancelled.");
      const answer = await input.negotiate(sdp, setupAbort.signal);
      if (disposed) throw new Error("The voice connection was cancelled.");
      session.setProtocol(answer.protocol ?? "live");
      await transport.answer(answer.sdp);
      const sessionId = await session.ready();
      if (answer.protocol !== "codex" && sessionId !== answer.sessionId)
        throw new Error("The voice session does not match its connection.");
    };
    // Permission prompts and RPCs can outlive cancellation. Their late result cannot reopen audio.
    await Promise.race([setup(), setupFailure]);
    if (disposed || input.signal.aborted) throw new Error("The voice connection was cancelled.");
    ready = true;
    return {
      session,
      close,
      setMuted: async (muted: boolean) => {
        if (disposed || input.signal.aborted) throw new Error("The voice call has ended.");
        if (muted) transport.setMicrophoneEnabled(false);
        try {
          await session.setMuted(muted);
          if (disposed || input.signal.aborted) throw new Error("The voice call has ended.");
          if (!muted) transport.setMicrophoneEnabled(true);
        } catch (error) {
          session.fail("The microphone change could not be confirmed.");
          throw error;
        }
      },
    };
  } catch (error) {
    const message =
      error instanceof VoiceCallSetupError
        ? error.message
        : "Could not establish the voice connection.";
    session.fail(message);
    cleanup();
    // A synchronous factory failure may dispose before it returns its media handles.
    media?.dispose();
    throw error instanceof VoiceCallSetupError ? error : new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}
