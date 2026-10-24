import type { EnvironmentId, ThreadId, VoiceConnection, VoiceSelection } from "@t3tools/contracts";
import type {
  VoiceCallPhase,
  VoiceCallState,
  VoiceCallTarget,
  VoiceCallTranscriptEntry,
} from "@t3tools/client-runtime/voice-call";

/**
 * Every control names the call it was rendered for. A click that lands after the call changed
 * then misses in the runtime instead of hanging up or muting a newer call.
 */
export interface BotCallControls {
  readonly toggleMute: (callId: string) => void;
  readonly end: (callId: string) => void;
  readonly openChat: (call: VoiceCallTarget) => void;
}

/** What a transcript renders; ended calls load these without the live revision bookkeeping. */
export type BotCallTranscriptLine = Pick<
  VoiceCallTranscriptEntry,
  "id" | "speaker" | "text" | "final"
>;

export type BotCallAvailability =
  | { readonly kind: "available" }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
      /** The bot's voice needs fixing in Voice settings, as opposed to the server or connection. */
      readonly setup?: boolean;
    };

/**
 * Whether this client can start a call on the voice route the bot's settings select. A voice is
 * only selectable from the server's catalog, and the server re-checks the account when the call
 * connects, so a saved key or linked ChatGPT sign-in is enough here; neither falls back to another.
 */
export function resolveBotCallAvailability(input: {
  readonly supported: boolean;
  readonly connected: boolean;
  readonly canCall: boolean;
  readonly selection: VoiceSelection | null;
  readonly connection: VoiceConnection | undefined;
}): BotCallAvailability {
  if (!input.supported) {
    return {
      kind: "unavailable",
      reason:
        "This environment’s T3 Code server doesn’t support calls yet. Update it to call bots.",
    };
  }
  if (!input.connected) {
    return { kind: "unavailable", reason: "This environment isn’t connected." };
  }
  if (!input.canCall) {
    return { kind: "unavailable", reason: "This connection can’t start calls here." };
  }
  const setup = (reason: string): BotCallAvailability => ({
    kind: "unavailable",
    reason,
    setup: true,
  });
  const { selection, connection } = input;
  if (selection === null) return setup("Choose a voice in Voice settings to call.");
  if (connection === undefined) {
    return setup("This voice’s account was removed. Choose another voice to call.");
  }
  switch (connection.kind) {
    case "codex-subscription":
      return { kind: "available" };
    case "openai-api":
    case "xai-api":
      return connection.apiKey.length === 0
        ? setup(`Add an API key to ${connection.name} in Voice settings to call.`)
        : { kind: "available" };
  }
}

export function botCallPhaseLabel(phase: VoiceCallPhase, muted: boolean): string {
  switch (phase) {
    case "connecting":
      return "Connecting…";
    case "listening":
      return muted ? "Muted" : "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "reconnecting":
      return "Reconnecting…";
    case "failed":
      return "Call failed";
  }
}

/**
 * What a screen reader hears about a call: only when it starts connecting, goes live, drops
 * into reconnecting, or fails. Listening, thinking, speaking, and mute all read as one live
 * state, so turn-taking never re-announces, and nothing said on the call is ever included.
 */
export function botCallAnnouncement(
  call: Pick<VoiceCallState, "phase" | "error" | "bot"> | null,
): string {
  if (call === null) return "";
  const title = call.bot.title;
  switch (call.phase) {
    case "connecting":
      return `Calling ${title}…`;
    case "reconnecting":
      return `Reconnecting call with ${title}…`;
    case "failed":
      return call.error ? `Call with ${title} failed. ${call.error}` : `Call with ${title} failed.`;
    case "listening":
    case "thinking":
    case "speaking":
      return `Call with ${title} connected.`;
  }
}

/** Mute is meaningful only once audio is flowing. */
export function botCallCanToggleMute(phase: VoiceCallPhase): boolean {
  return phase === "listening" || phase === "thinking" || phase === "speaking";
}

export type BotCallStartDecision =
  /** `replacingCallId` names the exact call to end first, so a stale tap cannot end a newer one. */
  | { readonly kind: "start"; readonly replacingCallId: string | null }
  | { readonly kind: "open-active" }
  | {
      readonly kind: "confirm-switch";
      readonly replacingCallId: string;
      readonly activeBotTitle: string;
      readonly message: string;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

export type BotCallActive = Pick<
  VoiceCallState,
  "callId" | "environmentId" | "bot" | "threadRef" | "phase"
>;

/**
 * One call app-wide. Calling from the conversation already on the line goes back to that call;
 * calling from anywhere else, another topic with the same bot included, asks first, so the user
 * is never silently talking somewhere new. A failed call is no longer on the line, so calling
 * again replaces it without asking. A null `threadId` is a conversation not created yet.
 */
export function resolveBotCallStart(input: {
  readonly active: BotCallActive | null;
  readonly target: {
    readonly environmentId: EnvironmentId;
    readonly bot: VoiceCallTarget["bot"];
    readonly threadId: ThreadId | null;
  };
  readonly availability: BotCallAvailability;
}): BotCallStartDecision {
  const { active, target } = input;
  const live = active !== null && active.phase !== "failed" ? active : null;
  if (
    live !== null &&
    live.environmentId === target.environmentId &&
    live.threadRef.threadId === target.threadId
  ) {
    return { kind: "open-active" };
  }
  if (input.availability.kind === "unavailable") {
    return { kind: "unavailable", reason: input.availability.reason };
  }
  if (live === null) return { kind: "start", replacingCallId: active?.callId ?? null };
  return {
    kind: "confirm-switch",
    replacingCallId: live.callId,
    activeBotTitle: live.bot.title,
    message:
      live.environmentId === target.environmentId && live.bot.id === target.bot.id
        ? `End your call with ${live.bot.title} in the other conversation and call from this one?\nYou can only be on one call at a time.`
        : `End your call with ${live.bot.title} and call ${target.bot.title}?\nYou can only be on one call at a time.`,
  };
}

export interface BotCallTargetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
