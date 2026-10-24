import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const VoiceConnectionId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export const VoiceSelection = Schema.Struct({
  connectionId: VoiceConnectionId,
  model: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  voice: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type VoiceSelection = typeof VoiceSelection.Type;

export const VoiceApiConnection = Schema.Struct({
  kind: Schema.Literals(["openai-api", "xai-api"]),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  apiKey: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))).annotateKey({
    settingsSecret: true,
  }),
});
export const VoiceSubscriptionConnection = Schema.Struct({
  kind: Schema.Literal("codex-subscription"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  providerInstanceId: ProviderInstanceId,
});
export const VoiceConnection = Schema.Union([VoiceApiConnection, VoiceSubscriptionConnection]);
export type VoiceConnection = typeof VoiceConnection.Type;

export const VoiceOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
});
export const VoiceModelOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  voices: Schema.Array(VoiceOption),
});
export const VoiceCatalog = Schema.Struct({
  connections: Schema.Array(
    Schema.Struct({
      id: VoiceConnectionId,
      kind: Schema.Literals(["openai-api", "xai-api", "codex-subscription"]),
      name: TrimmedNonEmptyString,
      status: Schema.Literals(["configured", "missing-credentials", "unavailable"]),
      reason: Schema.NullOr(Schema.String),
      models: Schema.Array(VoiceModelOption),
    }),
  ),
});
export type VoiceCatalog = typeof VoiceCatalog.Type;

export const VoiceCallId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export const VoiceCallEndReason = Schema.Literals([
  "user",
  "bot",
  "interrupted",
  "error",
  "replaced",
]);
export type VoiceCallEndReason = typeof VoiceCallEndReason.Type;

export const VoiceCallSummary = Schema.Struct({
  callId: VoiceCallId,
  botTitle: TrimmedNonEmptyString,
  endpointId: Schema.optional(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
  endReason: Schema.NullOr(VoiceCallEndReason),
});
export type VoiceCallSummary = typeof VoiceCallSummary.Type;

export const VoiceTranscriptFragment = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  text: Schema.String.check(Schema.isMaxLength(32_768)),
  startMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  endMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
}).check(Schema.makeFilter((fragment) => fragment.endMs >= fragment.startMs));
export type VoiceTranscriptFragment = typeof VoiceTranscriptFragment.Type;
const VoiceTranscriptFragments = Schema.Array(VoiceTranscriptFragment).check(
  Schema.isMaxLength(64),
);

export const VoiceTranscriptIdentity = Schema.Struct({
  callId: VoiceCallId,
  entryId: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  ordinal: NonNegativeInt,
  revision: NonNegativeInt,
  final: Schema.Boolean,
  fragments: Schema.optional(VoiceTranscriptFragments),
});

export const VoiceTranscriptEntry = Schema.Struct({
  id: VoiceTranscriptIdentity.fields.entryId,
  speaker: Schema.Literals(["user", "bot"]),
  text: Schema.String.check(Schema.isMaxLength(32_768)),
  ordinal: NonNegativeInt,
  revision: NonNegativeInt,
  final: Schema.Boolean,
  fragments: Schema.optional(VoiceTranscriptFragments),
}).check(
  Schema.makeFilter(
    (entry) =>
      entry.fragments === undefined ||
      entry.fragments.map((fragment) => fragment.text).join("") === entry.text,
  ),
);
export type VoiceTranscriptEntry = typeof VoiceTranscriptEntry.Type;

const VoiceCallWriterFields = {
  threadId: ThreadId,
  callId: VoiceCallId,
  endpointId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
};
export const VoiceCallContextInput = Schema.Struct(VoiceCallWriterFields);
export type VoiceCallContextInput = typeof VoiceCallContextInput.Type;

export const VoiceCallBeginInput = Schema.Struct({
  ...VoiceCallWriterFields,
  replacingCallId: Schema.optional(VoiceCallId),
  replacingEndpointId: Schema.optional(TrimmedNonEmptyString),
});
export const VoiceCallAppendInput = Schema.Struct({
  ...VoiceCallWriterFields,
  entries: Schema.Array(VoiceTranscriptEntry).check(Schema.isMaxLength(32)),
});
export const VoiceCallEndInput = Schema.Struct({
  ...VoiceCallWriterFields,
  reason: VoiceCallEndReason,
  entries: Schema.optional(VoiceCallAppendInput.fields.entries),
});
export const VoiceCallConnectInput = Schema.Struct({
  ...VoiceCallWriterFields,
  transport: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("webrtc"),
      sdp: Schema.NonEmptyString.check(Schema.isMaxLength(131_072)),
    }),
    Schema.Struct({ type: Schema.Literal("websocket") }),
  ]),
});
export type VoiceCallConnectInput = typeof VoiceCallConnectInput.Type;

export const VoiceCallWorkInput = Schema.Struct({
  ...VoiceCallWriterFields,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
  viewContext: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
});
export type VoiceCallWorkInput = typeof VoiceCallWorkInput.Type;
export const VoiceCallWorkResult = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  messageId: MessageId,
});
export type VoiceCallWorkResult = typeof VoiceCallWorkResult.Type;

export class VoiceWorkError extends Schema.TaggedError<VoiceWorkError>()("VoiceWorkError", {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return "The work could not be sent to this conversation's agent.";
  }
}

export const VoiceSessionContext = Schema.Struct({
  instructions: Schema.String,
  history: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["developer", "user", "assistant"]),
      text: Schema.String,
    }),
  ),
});
export type VoiceSessionContext = typeof VoiceSessionContext.Type;

export const VoiceCallContext = Schema.Struct({
  ...VoiceSessionContext.fields,
  transport: Schema.Literals(["webrtc", "websocket"]),
});
export type VoiceCallContext = typeof VoiceCallContext.Type;

export const VoiceCallConnectionInfo = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("openai-live"),
    protocol: Schema.optional(Schema.Literal("codex")),
    sessionId: Schema.NonEmptyString,
    sdp: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("grok"),
    clientSecret: Schema.NonEmptyString,
    expiresAt: NonNegativeInt,
    model: Schema.NonEmptyString,
    voice: Schema.NonEmptyString,
    context: VoiceSessionContext,
  }),
]);
export type VoiceCallConnectionInfo = typeof VoiceCallConnectionInfo.Type;

export class VoiceConnectionError extends Schema.TaggedError<VoiceConnectionError>()(
  "VoiceConnectionError",
  {
    reason: Schema.Literals([
      "not-configured",
      "unavailable",
      "transport-mismatch",
      "already-attempted",
      "credentials-refused",
      "rate-limited",
      "request-failed",
      "invalid-response",
      "storage",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-configured":
        return "Choose a voice account and voice in Settings → Voice.";
      case "unavailable":
        return "The selected voice is unavailable. Check Settings → Voice.";
      case "transport-mismatch":
        return "This client cannot connect to the selected voice provider.";
      case "already-attempted":
        return "This voice connection was already attempted. Start a new call to try again.";
      case "credentials-refused":
        return "The voice provider did not accept these credentials.";
      case "rate-limited":
        return "The voice provider's usage limit was reached.";
      case "request-failed":
        return "Could not connect to the voice provider.";
      case "invalid-response":
        return "The voice provider returned an invalid connection response.";
      case "storage":
        return "Could not prepare the voice conversation.";
    }
  }
}
export const VoiceActiveCall = Schema.NullOr(
  Schema.Struct({ threadId: ThreadId, call: VoiceCallSummary }),
);
export type VoiceActiveCall = typeof VoiceActiveCall.Type;

export const VoiceTranscriptPageInput = Schema.Struct({
  threadId: ThreadId,
  callId: VoiceCallId,
  afterOrdinal: Schema.optional(NonNegativeInt),
});
export type VoiceTranscriptPageInput = typeof VoiceTranscriptPageInput.Type;

export const VoiceTranscriptPage = Schema.Struct({
  entries: Schema.Array(VoiceTranscriptEntry),
  nextOrdinal: Schema.NullOr(NonNegativeInt),
});
export type VoiceTranscriptPage = typeof VoiceTranscriptPage.Type;

export class VoiceCallError extends Schema.TaggedError<VoiceCallError>()("VoiceCallError", {
  reason: Schema.Literals([
    "not-found",
    "not-bot",
    "active-call-changed",
    "owner-changed",
    "ended",
    "invalid-entry",
    "storage",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return "The voice conversation was not found.";
      case "not-bot":
        return "Voice calls belong to bot conversations.";
      case "active-call-changed":
        return "The active call changed. Try again.";
      case "owner-changed":
        return "This call belongs to another device.";
      case "ended":
        return "This call has ended.";
      case "invalid-entry":
        return "The transcript update conflicts with its saved history.";
      case "storage":
        return "Could not save or load the voice conversation.";
    }
  }
}
