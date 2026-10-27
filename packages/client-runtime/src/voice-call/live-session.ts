// @effect-diagnostics globalTimers:off - The client data channel owns these acknowledgment deadlines, outside an Effect runtime.
import * as Schema from "effect/Schema";

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const Interval = {
  start_ms: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  end_ms: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
};
const Transcript = Schema.Struct({
  event_id: Schema.NonEmptyString,
  delta: Schema.String,
  ...Interval,
});
const Delegation = Schema.Struct({
  offset_ms: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  delegation: Schema.Struct({ id: Schema.NonEmptyString, target: Schema.Literal("client") }),
});
const Acknowledgment = Schema.Struct({ client_event_id: Schema.String });
const SessionStarted = Schema.Struct({ session: Schema.Struct({ id: Schema.NonEmptyString }) });
const SessionClosed = Schema.Struct({ reason: Schema.String });
const CommandError = Schema.Struct({
  error: Schema.Struct({ client_event_id: Schema.optional(Schema.NullOr(Schema.String)) }),
});
const Envelope = Schema.Struct({ type: Schema.String });
const decodeLegacyText = Schema.decodeUnknownSync(
  Schema.Struct({ item: Schema.Struct({ text: Schema.String }) }),
);
const decodeLegacyDone = Schema.decodeUnknownSync(
  Schema.Struct({
    turn: Schema.Struct({
      role: Schema.Literals(["user", "assistant"]),
      transcript: Schema.String,
    }),
  }),
);
const decodeLegacyDelegation = Schema.decodeUnknownSync(
  Schema.Struct({
    item: Schema.Struct({
      id: Schema.NonEmptyString,
      type: Schema.Literal("delegation"),
      target: Schema.Literal("client"),
      content: Schema.Array(
        Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
      ),
    }),
  }),
);
const decodeEnvelope = Schema.decodeUnknownSync(Envelope);
const decodeStarted = Schema.decodeUnknownSync(SessionStarted);
const decodeTranscript = Schema.decodeUnknownSync(Transcript);
const decodeDelegation = Schema.decodeUnknownSync(Delegation);
const decodeAcknowledgment = Schema.decodeUnknownSync(Acknowledgment);
const decodeError = Schema.decodeUnknownSync(CommandError);
const decodeClosed = Schema.decodeUnknownSync(SessionClosed);

export interface LiveTranscriptFragment {
  readonly id: string;
  readonly speaker: "user" | "bot";
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

// Live has timed text fragments, not Realtime item ids or completed-turn events.
// Preserve the fragments for history; grouping words never proves audio was played.
// https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas

interface PendingCommand {
  readonly acknowledgment: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** GPT Live's text/control channel. No PCM, recordings, or playback buffers enter this class. */
export class LiveSession {
  private readonly send: (packet: string) => void;
  private readonly createEventId: () => string;
  private readonly callbacks: {
    readonly onTranscript: (fragment: LiveTranscriptFragment) => void;
    readonly onDelegation: (delegation: {
      readonly id: string;
      readonly offsetMs: number;
      readonly text?: string;
    }) => void;
    readonly onUntimedTranscript?: (entry: {
      readonly id: string;
      readonly speaker: "user" | "bot";
      readonly text: string;
      readonly final: boolean;
    }) => void;
    readonly onClosed: (reason: string) => void;
    readonly onFailure: (message: string) => void;
  };
  private readonly pending = new Map<string, PendingCommand>();
  private readonly seenFragments = new Set<string>();
  private readonly delegations = new Set<string>();
  private readonly startup = deferred<string>();
  private readonly shutdown = deferred<void>();
  private protocol: "live" | "codex" = "live";
  private readonly untimed = { user: { ordinal: 0, text: "" }, bot: { ordinal: 0, text: "" } };
  private started = false;
  private closing = false;
  private finished = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(input: {
    readonly send: (packet: string) => void;
    readonly createEventId: () => string;
    readonly callbacks: LiveSession["callbacks"];
  }) {
    this.send = input.send;
    this.createEventId = input.createEventId;
    this.callbacks = input.callbacks;
    // Transport failures can precede the caller's first await during SDP negotiation.
    void this.startup.promise.catch(() => undefined);
    void this.shutdown.promise.catch(() => undefined);
  }

  setProtocol(protocol: "live" | "codex"): void {
    this.protocol = protocol;
  }

  get supportsQuietContext(): boolean {
    return this.protocol !== "codex";
  }

  readonly ready = (): Promise<string> => this.startup.promise;

  receive(packet: string): void {
    if (this.finished) return;
    try {
      const value: unknown = JSON.parse(packet);
      const { type } = decodeEnvelope(value);
      switch (type) {
        case "input_transcript.added":
        case "output_transcript.added": {
          if (this.protocol !== "codex") return;
          const speaker = type === "input_transcript.added" ? "user" : "bot";
          const current = this.untimed[speaker];
          current.text += decodeLegacyText(value).item.text;
          this.callbacks.onUntimedTranscript?.({
            id: `codex-${speaker}-${current.ordinal}`,
            speaker,
            text: current.text,
            final: false,
          });
          return;
        }
        case "turn.done": {
          if (this.protocol !== "codex") return;
          const { turn } = decodeLegacyDone(value);
          const speaker = turn.role === "user" ? "user" : "bot";
          const current = this.untimed[speaker];
          this.callbacks.onUntimedTranscript?.({
            id: `codex-${speaker}-${current.ordinal++}`,
            speaker,
            text: turn.transcript,
            final: true,
          });
          current.text = "";
          return;
        }
        case "delegation.created": {
          if (this.protocol !== "codex") return;
          const { item } = decodeLegacyDelegation(value);
          if (this.closing || this.delegations.has(item.id)) return;
          this.delegations.add(item.id);
          this.callbacks.onDelegation({
            id: item.id,
            offsetMs: 0,
            text: item.content
              .filter((part) => part.type === "input_text")
              .map((part) => part.text ?? "")
              .join(""),
          });
          return;
        }
        case "session.updated":
          if (this.protocol !== "codex") return;
        case "session.started": {
          const event = decodeStarted(value);
          this.started = true;
          this.startup.resolve(event.session.id);
          return;
        }
        case "session.input_transcript.delta":
        case "session.output_transcript.delta": {
          const event = decodeTranscript(value);
          if (event.end_ms < event.start_ms) throw new Error("Invalid transcript interval");
          if (this.seenFragments.has(event.event_id)) return;
          this.seenFragments.add(event.event_id);
          this.callbacks.onTranscript({
            id: event.event_id,
            speaker: type === "session.input_transcript.delta" ? "user" : "bot",
            text: event.delta,
            startMs: event.start_ms,
            endMs: event.end_ms,
          });
          return;
        }
        case "session.delegation.created": {
          const event = decodeDelegation(value);
          if (this.closing || this.delegations.has(event.delegation.id)) return;
          this.delegations.add(event.delegation.id);
          this.callbacks.onDelegation({ id: event.delegation.id, offsetMs: event.offset_ms });
          return;
        }
        case "session.input_audio.muted":
        case "session.input_audio.unmuted":
        case "session.thinking.appended":
        case "session.commentary.appended":
        case "session.instructions.appended": {
          const event = decodeAcknowledgment(value);
          const command = this.pending.get(event.client_event_id);
          if (command?.acknowledgment !== type) return;
          clearTimeout(command.timer);
          this.pending.delete(event.client_event_id);
          command.resolve();
          return;
        }
        case "error": {
          const event = decodeError(value);
          const id = event.error.client_event_id;
          if (id) {
            const command = this.pending.get(id);
            if (command !== undefined) {
              clearTimeout(command.timer);
              this.pending.delete(id);
              command.reject(new Error("The voice provider did not accept this update."));
            }
            return;
          }
          this.fail("The voice provider reported a connection error.");
          return;
        }
        case "session.closed": {
          const event = decodeClosed(value);
          this.finish();
          this.shutdown.resolve();
          this.callbacks.onClosed(event.reason);
        }
      }
    } catch {
      this.fail("The voice provider sent an invalid session event.");
    }
  }

  setMuted(muted: boolean): Promise<void> {
    if (this.protocol === "codex") return Promise.resolve();
    return this.command(
      { type: muted ? "session.input_audio.mute" : "session.input_audio.unmute" },
      muted ? "session.input_audio.muted" : "session.input_audio.unmuted",
    );
  }

  appendContext(input: {
    readonly text: string;
    readonly delegationId?: string;
    readonly speak?: boolean;
  }): Promise<void> {
    if (input.delegationId !== undefined && !this.delegations.has(input.delegationId)) {
      return Promise.reject(new Error("This task belongs to a different voice session."));
    }
    if (this.protocol === "codex") {
      // Commentary appends can provoke speech on the subscription endpoint. It has no
      // thinking.append equivalent; fetch fresh context through a requested delegation.
      if (!input.speak) return Promise.resolve();
      if (!this.started || this.closing || this.finished)
        return Promise.reject(new Error("The voice session is not ready."));
      try {
        this.send(
          JSON.stringify({
            type:
              input.delegationId === undefined
                ? "session.context.append"
                : "delegation.context.append",
            ...(input.delegationId === undefined ? {} : { delegation_item_id: input.delegationId }),
            channel: "speakable",
            content: [{ type: "input_text", text: input.text }],
          }),
        );
        // Codex append acknowledgments have no client event ID to correlate.
        // Provider errors still stop the call; delivery does not prove speech playback.
        return Promise.resolve();
      } catch {
        return Promise.reject(new Error("The voice context could not be sent."));
      }
    }
    // Append acknowledgments confirm context delivery, never that these words were spoken.
    return this.command(
      {
        type: input.speak ? "session.commentary.append" : "session.thinking.append",
        delegation_id: input.delegationId ?? null,
        content: input.text,
      },
      input.speak ? "session.commentary.appended" : "session.thinking.appended",
    );
  }

  appendInstructions(text: string): Promise<void> {
    if (this.protocol === "codex") return this.appendContext({ text });
    return this.command(
      { type: "session.instructions.append", content: text },
      "session.instructions.appended",
    );
  }

  close(): Promise<void> {
    if (this.closing || this.finished) return this.shutdown.promise;
    this.closing = true;
    this.closeTimer = setTimeout(
      () => {
        if (this.protocol === "codex") {
          for (const speaker of ["user", "bot"] as const) {
            const current = this.untimed[speaker];
            if (current.text)
              this.callbacks.onUntimedTranscript?.({
                id: `codex-${speaker}-${current.ordinal}`,
                speaker,
                text: current.text,
                final: true,
              });
          }
          this.finish();
          this.shutdown.resolve();
        } else this.fail("Voice call finalization was not confirmed.");
      },
      this.protocol === "codex" ? 1500 : 5000,
    );
    try {
      this.send(JSON.stringify({ type: "session.close", event_id: this.createEventId() }));
    } catch {
      this.fail("Voice call finalization was not confirmed.");
    }
    return this.shutdown.promise;
  }

  fail(message: string): void {
    if (this.finished) return;
    this.finish();
    this.shutdown.reject(new Error(message));
    this.callbacks.onFailure(message);
  }

  private finish(): void {
    this.finished = true;
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.startup.reject(new Error("The voice session ended before it was ready."));
    for (const command of this.pending.values()) {
      clearTimeout(command.timer);
      command.reject(new Error("The voice session ended before this update was confirmed."));
    }
    this.pending.clear();
  }

  private command(
    packet: { readonly type: string; readonly [key: string]: unknown },
    acknowledgment: string,
  ): Promise<void> {
    if (!this.started || this.closing || this.finished) {
      return Promise.reject(new Error("The voice session is not ready for updates."));
    }
    const id = this.createEventId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The voice update was not confirmed."));
      }, 20_000);
      this.pending.set(id, { acknowledgment, resolve, reject, timer });
      try {
        this.send(JSON.stringify({ ...packet, event_id: id }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Could not send the update to the voice provider."));
      }
    });
  }
}
