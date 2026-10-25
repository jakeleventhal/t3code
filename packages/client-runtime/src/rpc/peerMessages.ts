import {
  AuthOrchestrationOperateScope,
  authScopeRequiredResponse,
  EnvironmentAuthorizationError,
  type EnvironmentId,
  PeerEnvironmentFailureCode,
  type PeerEnvironmentThreadSendInput,
  sessionGrantsScope,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import * as ManagedRelay from "../relay/managedRelay.ts";
import * as RemoteAuthorization from "../authorization/service.ts";
import { fetchEnvironmentSessionState } from "../state/session.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as EnvironmentRpc from "./client.ts";

export class PeerRequestFailure extends Schema.TaggedError<PeerRequestFailure>()(
  "PeerRequestFailure",
  {
    code: PeerEnvironmentFailureCode,
    message: Schema.String,
    deliveryUncertain: Schema.optional(Schema.Boolean),
  },
) {}

// These background carrier mutations have no mounted command registry. Verify the
// current session at the RPC boundary; the destination server checks it again.
const withPeerAccess = Effect.fn("EnvironmentRpc.withPeerAccess")(function* <A, E, R>(
  environmentId: EnvironmentId,
  method: typeof WS_METHODS.peerEnvironmentsSendToThread | typeof WS_METHODS.peerMessagesFlush,
  effect: Effect.Effect<A, E, R>,
) {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  const http = yield* Effect.serviceOption(HttpClient.HttpClient);
  if (Option.isNone(prepared) || Option.isNone(http)) {
    return yield* new PeerRequestFailure({
      code: "environment_not_connected",
      message: "The destination connection is unavailable.",
    });
  }
  const access = yield* fetchEnvironmentSessionState({
    prepared: prepared.value,
    signer: yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner),
    remoteAuthorization: yield* Effect.serviceOption(
      RemoteAuthorization.RemoteEnvironmentAuthorization,
    ),
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, http.value),
    Effect.mapError(
      () =>
        new PeerRequestFailure({
          code: "environment_unauthorized",
          message: "Could not verify access to the destination.",
        }),
    ),
  );
  return yield* effect.pipe(
    Effect.provideService(EnvironmentRpc.RpcPermissionGuard, {
      authorize: (destination, requestedMethod) =>
        destination === environmentId &&
        requestedMethod === method &&
        sessionGrantsScope(access, AuthOrchestrationOperateScope)
          ? Effect.void
          : Effect.fail(
              new EnvironmentAuthorizationError({
                ...authScopeRequiredResponse(AuthOrchestrationOperateScope),
                message: "This connection cannot send requests to the destination.",
              }),
            ),
    }),
  );
});

export const sendPeerThreadMessage = Effect.fn("EnvironmentRpc.sendPeerThreadMessage")(function* (
  environmentId: EnvironmentId,
  input: PeerEnvironmentThreadSendInput,
) {
  const config = yield* EnvironmentRpc.getInitialServerConfig();
  if (config.environment.capabilities.peerMessages !== true)
    return yield* new PeerRequestFailure({
      code: "environment_incompatible",
      message: "Update the destination's T3 Code server to receive requests from other bots.",
    });
  return yield* withPeerAccess(
    environmentId,
    WS_METHODS.peerEnvironmentsSendToThread,
    EnvironmentRpc.requestGuarded(WS_METHODS.peerEnvironmentsSendToThread, input),
  );
});

export const flushPeerMessages = Effect.fn("EnvironmentRpc.flushPeerMessages")(function* (
  environmentId: EnvironmentId,
) {
  const config = yield* EnvironmentRpc.getInitialServerConfig();
  if (config.environment.capabilities.peerMessageOutbox !== true) return;
  yield* withPeerAccess(
    environmentId,
    WS_METHODS.peerMessagesFlush,
    EnvironmentRpc.requestGuarded(WS_METHODS.peerMessagesFlush, {}),
  );
});
