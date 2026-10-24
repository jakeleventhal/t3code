import type {
  EnvironmentId,
  ProjectBotRole,
  ScopedThreadRef,
  VoiceTranscriptFragment,
} from "@t3tools/contracts";

export type VoiceCallPhase =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "failed";

export type VoiceCallEndReason = "user" | "bot" | "interrupted" | "error" | "replaced";

export interface VoiceCallTarget {
  readonly environmentId: EnvironmentId;
  readonly bot: {
    readonly id: string;
    readonly title: string;
    readonly botRole: ProjectBotRole | null;
  };
  readonly threadRef: ScopedThreadRef;
}

export interface VoiceCallState extends VoiceCallTarget {
  readonly callId: string;
  readonly phase: VoiceCallPhase;
  readonly muted: boolean;
  readonly error: string | null;
  readonly canSendText: boolean;
}

export interface VoiceCallTranscriptEntry {
  readonly id: string;
  readonly speaker: "user" | "bot";
  readonly text: string;
  readonly final: boolean;
  /** Adapters increase this on correction; a replay must retain its original revision. */
  readonly revision: number;
  /** Stable conversation order, independent of the order network packets arrive. */
  readonly ordinal: number;
  readonly fragments?: ReadonlyArray<VoiceTranscriptFragment>;
}

export type VoiceCallEvent =
  | { readonly type: "identity"; readonly callId: string }
  | { readonly type: "phase"; readonly phase: Exclude<VoiceCallPhase, "connecting" | "failed"> }
  | { readonly type: "transcript"; readonly entry: VoiceCallTranscriptEntry }
  | { readonly type: "ended"; readonly reason: VoiceCallEndReason }
  | { readonly type: "failed"; readonly message: string };

/** The transport owns audio, persistence, and authorization; audio never enters this store. */
export interface VoiceCallConnection {
  readonly close: (reason: VoiceCallEndReason) => Promise<void>;
  readonly setMuted: (muted: boolean) => Promise<void>;
  readonly sendText?: ((text: string) => Promise<void>) | undefined;
}

export interface VoiceCallConnector {
  /** Abort must release local capture even if connection setup has not resolved yet. */
  readonly connect: (input: {
    readonly callId: string;
    readonly endpointId?: string;
    readonly target: VoiceCallTarget;
    readonly signal: AbortSignal;
    readonly onEvent: (event: VoiceCallEvent) => void;
  }) => Promise<VoiceCallConnection>;
}

export interface VoiceCallDraft {
  readonly text: string;
  readonly sending: boolean;
  readonly error: string | null;
}

export type VoiceCallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** Only application-owned, safe messages may cross the provider adapter into the UI. */
export class VoiceCallSetupError extends Error {}

interface ActiveCall {
  callId: string;
  readonly target: VoiceCallTarget;
  readonly abort: AbortController;
  readonly entries: Map<string, VoiceCallTranscriptEntry>;
  transcript: ReadonlyArray<VoiceCallTranscriptEntry> | null;
  connection: VoiceCallConnection | null;
  closePromise: Promise<void> | null;
  endReason: VoiceCallEndReason | null;
  muting: boolean;
}

const EMPTY_TRANSCRIPT: ReadonlyArray<VoiceCallTranscriptEntry> = [];
const EMPTY_DRAFT: VoiceCallDraft = { text: "", sending: false, error: null };
const failure = (error: string): VoiceCallResult => ({ ok: false, error });
const targetKey = (target: VoiceCallTarget) =>
  JSON.stringify([target.environmentId, target.threadRef.threadId]);

/** One instance belongs to the app root, so navigation and collapsed drawers cannot end a call. */
export class VoiceCallController {
  private readonly connector: VoiceCallConnector;
  private readonly createCallId: () => string;
  private active: ActiveCall | null = null;
  private state: VoiceCallState | null = null;
  private starting = false;
  private readonly stateListeners = new Set<() => void>();
  private readonly transcriptListeners = new Set<() => void>();
  private readonly draftListeners = new Set<() => void>();
  private readonly drafts = new Map<string, VoiceCallDraft>();
  private readonly pendingSends = new Map<string, symbol>();

  constructor(connector: VoiceCallConnector, createCallId: () => string) {
    this.connector = connector;
    this.createCallId = createCallId;
  }

  readonly getSnapshot = (): VoiceCallState | null => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  readonly subscribeTranscript = (listener: () => void): (() => void) => {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  };

  readonly subscribeDraft = (listener: () => void): (() => void) => {
    this.draftListeners.add(listener);
    return () => this.draftListeners.delete(listener);
  };

  getTranscript(callId: string): ReadonlyArray<VoiceCallTranscriptEntry> {
    const call = this.active;
    if (call === null || call.callId !== callId) return EMPTY_TRANSCRIPT;
    // Most calls keep the drawer closed. Only a transcript reader pays for sorting/copying.
    call.transcript ??= [...call.entries.values()].sort(
      (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
    );
    return call.transcript;
  }

  getDraft(callId: string): VoiceCallDraft {
    const call = this.active;
    if (call === null || call.callId !== callId) return EMPTY_DRAFT;
    return this.drafts.get(targetKey(call.target)) ?? EMPTY_DRAFT;
  }

  setDraft(callId: string, text: string): void {
    const call = this.active;
    if (call === null || call.callId !== callId) return;
    const current = this.getDraft(callId);
    if (text === current.text) return;
    this.drafts.set(targetKey(call.target), { ...current, text, error: null });
    this.notify(this.draftListeners);
  }

  async start(
    target: VoiceCallTarget,
    options: { readonly replacingCallId?: string } = {},
  ): Promise<VoiceCallResult> {
    if (this.starting) return failure("A voice connection is already starting.");
    if (target.environmentId !== target.threadRef.environmentId) {
      return failure("The conversation belongs to a different environment.");
    }
    const previous = this.active;
    if (previous !== null) {
      if (options.replacingCallId !== previous.callId) {
        return failure("End the current call before starting another one.");
      }
    } else if (options.replacingCallId !== undefined) {
      return failure("The active call changed. Try again.");
    }
    this.starting = true;
    const call: ActiveCall = {
      callId: this.createCallId(),
      target,
      abort: new AbortController(),
      entries: new Map(),
      transcript: null,
      connection: null,
      closePromise: null,
      endReason: null,
      muting: false,
    };
    if (previous !== null) this.retire(previous, "replaced");
    this.active = call;
    this.setState({
      ...target,
      callId: call.callId,
      phase: "connecting",
      muted: false,
      error: null,
      canSendText: false,
    });
    this.notify(this.transcriptListeners);
    this.notify(this.draftListeners);
    try {
      if (previous !== null) await this.close(previous);
      if (!this.isCurrent(call)) return failure("The call was ended.");
      const connection = await this.connector.connect({
        callId: call.callId,
        target,
        signal: call.abort.signal,
        onEvent: (event) => this.receive(call, event),
      });
      call.connection = connection;
      if (!this.isCurrent(call)) {
        await this.close(call);
        return failure("The call was ended.");
      }
      if (this.state !== null) {
        this.setState({ ...this.state, canSendText: connection.sendText !== undefined });
      }
      // A resolved setup is not proof of media flowing. The adapter reports the real phase.
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof VoiceCallSetupError ? error.message : "Could not connect the voice call.";
      if (this.isCurrent(call)) {
        this.fail(call, message);
      }
      return failure(message);
    } finally {
      this.starting = false;
    }
  }

  async end(callId: string, reason: VoiceCallEndReason = "user"): Promise<VoiceCallResult> {
    const call = this.active;
    if (call === null || call.callId !== callId) return { ok: true };
    this.retire(call, reason);
    this.active = null;
    this.setState(null);
    this.notify(this.transcriptListeners);
    this.notify(this.draftListeners);
    try {
      await this.close(call);
      return { ok: true };
    } catch {
      return failure("Audio stopped, but the call could not finish syncing.");
    }
  }

  async toggleMute(callId: string): Promise<VoiceCallResult> {
    const call = this.active;
    const state = this.state;
    if (
      call === null ||
      call.callId !== callId ||
      call.connection === null ||
      !this.isCurrent(call) ||
      call.muting ||
      state === null ||
      state.phase === "connecting" ||
      state.phase === "failed" ||
      state.phase === "reconnecting"
    )
      return failure("The call is not ready to change microphone state.");
    call.muting = true;
    const muted = !state.muted;
    try {
      await call.connection.setMuted(muted);
      if (this.isCurrent(call) && this.state !== null) this.setState({ ...this.state, muted });
      return { ok: true };
    } catch {
      return failure("Could not change the microphone state.");
    } finally {
      call.muting = false;
    }
  }

  async sendDraft(callId: string): Promise<VoiceCallResult> {
    const call = this.active;
    if (call === null || call.callId !== callId || !this.isCurrent(call)) {
      return failure("The call is no longer active.");
    }
    const sendText = call.connection?.sendText;
    const key = targetKey(call.target);
    const draft = this.getDraft(callId);
    if (!sendText) {
      const error = "This call cannot receive typed messages.";
      this.drafts.set(key, { ...draft, error });
      this.notify(this.draftListeners);
      return failure(error);
    }
    if (draft.sending) return failure("Your message is already sending.");
    if (!draft.text.trim()) return failure("Enter a message first.");
    const send = Symbol();
    this.pendingSends.set(key, send);
    this.drafts.set(key, { ...draft, sending: true, error: null });
    this.notify(this.draftListeners);
    let error: string | null = null;
    try {
      await sendText(draft.text.trim());
    } catch {
      error = "Could not send your message to the call.";
    }
    // A retired call cannot clear or re-block the same conversation's new composer.
    if (this.pendingSends.get(key) !== send) {
      return error === null ? { ok: true } : failure(error);
    }
    this.pendingSends.delete(key);
    const current = this.drafts.get(key) ?? EMPTY_DRAFT;
    this.drafts.set(key, {
      text: error === null && current.text === draft.text ? "" : current.text,
      sending: false,
      error,
    });
    this.notify(this.draftListeners);
    return error === null ? { ok: true } : failure(error);
  }

  private receive(call: ActiveCall, event: VoiceCallEvent): void {
    if (!this.isCurrent(call)) return;
    switch (event.type) {
      case "identity":
        call.callId = event.callId;
        if (this.state !== null) this.setState({ ...this.state, callId: event.callId });
        return;
      case "phase":
        if (this.state !== null) this.setState({ ...this.state, phase: event.phase, error: null });
        return;
      case "transcript": {
        const previous = call.entries.get(event.entry.id);
        if (
          previous !== undefined &&
          (previous.revision >= event.entry.revision ||
            previous.speaker !== event.entry.speaker ||
            previous.ordinal !== event.entry.ordinal ||
            (previous.final && !event.entry.final))
        )
          return;
        call.entries.set(event.entry.id, event.entry);
        call.transcript = null;
        this.notify(this.transcriptListeners);
        return;
      }
      case "failed":
        this.fail(call, event.message);
        return;
      case "ended":
        void this.end(call.callId, event.reason);
    }
  }

  private fail(call: ActiveCall, message: string): void {
    this.retire(call, "error");
    if (this.state !== null) {
      this.setState({ ...this.state, phase: "failed", error: message, canSendText: false });
    }
    void this.close(call).catch(() => undefined);
  }

  private retire(call: ActiveCall, reason: VoiceCallEndReason): void {
    call.endReason ??= reason;
    const key = targetKey(call.target);
    if (this.pendingSends.delete(key)) {
      const draft = this.drafts.get(key) ?? EMPTY_DRAFT;
      this.drafts.set(key, {
        ...draft,
        sending: false,
        error: "The call ended before message delivery was confirmed.",
      });
      this.notify(this.draftListeners);
    }
    call.abort.abort(call.endReason);
  }

  private isCurrent(call: ActiveCall): boolean {
    return this.active === call && call.endReason === null;
  }

  private close(call: ActiveCall): Promise<void> {
    if (call.connection === null) return Promise.resolve();
    call.closePromise ??= Promise.resolve().then(() =>
      call.connection!.close(call.endReason ?? "user"),
    );
    return call.closePromise;
  }

  private setState(next: VoiceCallState | null): void {
    const previous = this.state;
    if (
      previous === next ||
      (previous !== null &&
        next !== null &&
        previous.callId === next.callId &&
        previous.phase === next.phase &&
        previous.muted === next.muted &&
        previous.canSendText === next.canSendText &&
        previous.error === next.error)
    )
      return;
    this.state = next;
    this.notify(this.stateListeners);
  }

  private notify(listeners: ReadonlySet<() => void>): void {
    for (const listener of listeners) listener();
  }
}
