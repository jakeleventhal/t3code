import { Schema } from "effect";

import {
  CommandId,
  IsoDateTime,
  MessageId,
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationProjectShell } from "./orchestrationProject.ts";
import {
  OrchestrationV2ThreadLaunchInput,
  OrchestrationV2ThreadLaunchResult,
  OrchestrationV2ThreadProjection,
  OrchestrationV2Run,
} from "./orchestrationV2.ts";
import { ServerProvider } from "./server.ts";
import { OrchestrationMessageContext } from "./composerContext.ts";
import { OrchestratorMcpThreadSendResult } from "./orchestratorMcp.ts";

/**
 * Peer environments are the other environments a connected client can reach.
 * A server never talks to another server: it asks a client that is connected
 * to both, and the client runs the request over its own session there.
 */
export const PeerEnvironmentStatus = Schema.Literals([
  "connected",
  "offline",
  "unauthorized",
  "incompatible",
]);
export type PeerEnvironmentStatus = typeof PeerEnvironmentStatus.Type;

export const PeerEnvironmentSummary = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  status: PeerEnvironmentStatus,
});
export type PeerEnvironmentSummary = typeof PeerEnvironmentSummary.Type;

export const PeerEnvironmentHost = Schema.Struct({
  clientId: TrimmedNonEmptyString,
});
export type PeerEnvironmentHost = typeof PeerEnvironmentHost.Type;

export const PeerEnvironmentThreadWaitInput = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  runId: Schema.optional(RunId),
  timeoutMs: Schema.Finite,
});
export const PeerEnvironmentThreadWaitResult = Schema.Struct({
  threadId: ThreadId,
  run: Schema.NullOr(OrchestrationV2Run),
  timedOut: Schema.Boolean,
});

export const PeerEnvironmentThreadSendInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(120000)),
  context: Schema.optional(OrchestrationMessageContext),
});
export type PeerEnvironmentThreadSendInput = typeof PeerEnvironmentThreadSendInput.Type;
export class PeerEnvironmentThreadSendError extends Schema.TaggedError<PeerEnvironmentThreadSendError>()(
  "PeerEnvironmentThreadSendError",
  { threadId: ThreadId, cause: Schema.Defect() },
) {
  override get message() {
    return "Could not deliver the request to this conversation.";
  }
}

export const PeerEnvironmentOperation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("thread_send"),
    environmentId: EnvironmentId,
    input: PeerEnvironmentThreadSendInput,
  }),
  Schema.Struct({
    operation: Schema.Literal("thread_wait"),
    environmentId: EnvironmentId,
    input: PeerEnvironmentThreadWaitInput,
  }),
  Schema.Struct({ operation: Schema.Literal("list") }),
  Schema.Struct({ operation: Schema.Literal("catalog"), environmentId: EnvironmentId }),
  Schema.Struct({
    operation: Schema.Literal("launch"),
    environmentId: EnvironmentId,
    input: OrchestrationV2ThreadLaunchInput,
  }),
  Schema.Struct({
    operation: Schema.Literal("thread_projection"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
  }),
]);
export type PeerEnvironmentOperation = typeof PeerEnvironmentOperation.Type;

export const PeerEnvironmentResult = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("thread_send"),
    result: OrchestratorMcpThreadSendResult,
  }),
  Schema.Struct({
    operation: Schema.Literal("thread_wait"),
    result: PeerEnvironmentThreadWaitResult,
  }),
  Schema.Struct({
    operation: Schema.Literal("list"),
    environments: Schema.Array(PeerEnvironmentSummary),
  }),
  Schema.Struct({
    operation: Schema.Literal("catalog"),
    label: Schema.String,
    serverVersion: Schema.String,
    providers: Schema.Array(ServerProvider),
    projects: Schema.Array(OrchestrationProjectShell),
  }),
  Schema.Struct({
    operation: Schema.Literal("launch"),
    result: OrchestrationV2ThreadLaunchResult,
  }),
  Schema.Struct({
    operation: Schema.Literal("thread_projection"),
    projection: OrchestrationV2ThreadProjection,
  }),
]);
export type PeerEnvironmentResult = typeof PeerEnvironmentResult.Type;

export const PeerEnvironmentFailureCode = Schema.Literals([
  "environment_not_connected",
  "environment_offline",
  "environment_unauthorized",
  "environment_incompatible",
  "environment_request_failed",
]);
export type PeerEnvironmentFailureCode = typeof PeerEnvironmentFailureCode.Type;

export const PeerEnvironmentRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  operation: PeerEnvironmentOperation,
  timeoutMs: Schema.Number,
});
export type PeerEnvironmentRequest = typeof PeerEnvironmentRequest.Type;

export const PeerEnvironmentStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("connected"),
    connectionId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("request"),
    connectionId: TrimmedNonEmptyString,
    request: PeerEnvironmentRequest,
  }),
]);
export type PeerEnvironmentStreamEvent = typeof PeerEnvironmentStreamEvent.Type;

export const PeerEnvironmentResponse = Schema.Struct({
  clientId: TrimmedNonEmptyString,
  connectionId: TrimmedNonEmptyString,
  requestId: TrimmedNonEmptyString,
  outcome: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), result: PeerEnvironmentResult }),
    Schema.Struct({
      ok: Schema.Literal(false),
      code: PeerEnvironmentFailureCode,
      message: Schema.String,
      deliveryUncertain: Schema.optional(Schema.Boolean),
    }),
  ]),
});
export type PeerEnvironmentResponse = typeof PeerEnvironmentResponse.Type;

export const PeerMessageOutboxItem = Schema.Struct({
  requestId: CommandId,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceTitle: Schema.String,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  text: Schema.String.check(Schema.isMaxLength(1000)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  status: Schema.Literals(["pending", "sending", "blocked", "delivered", "cancelled"]),
  uncertain: Schema.Boolean,
  result: Schema.NullOr(OrchestratorMcpThreadSendResult),
  error: Schema.NullOr(Schema.String),
});
export type PeerMessageOutboxItem = typeof PeerMessageOutboxItem.Type;
export const PeerMessageOutboxListInput = Schema.Struct({
  sourceThreadId: Schema.optional(ThreadId),
  environmentId: Schema.optional(EnvironmentId),
  threadId: Schema.optional(ThreadId),
});
export type PeerMessageOutboxListInput = typeof PeerMessageOutboxListInput.Type;
export const PeerMessageOutboxCancelInput = Schema.Struct({ requestId: CommandId });
export const PeerMessageOutboxFlushInput = Schema.Struct({
  environmentId: Schema.optional(EnvironmentId),
});
export class PeerMessageOutboxError extends Schema.TaggedError<PeerMessageOutboxError>()(
  "PeerMessageOutboxError",
  { operation: Schema.Literals(["enqueue", "list", "cancel", "deliver"]), cause: Schema.Defect() },
) {
  override get message() {
    return "Could not update queued bot requests.";
  }
}
