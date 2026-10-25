import { withPeerAccess } from "./peerMessages.ts";
import {
  type BotReplicaCursor,
  type BotReplicationStatus,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Registry from "../connection/registry.ts";
import * as Rpc from "./client.ts";

/** Clients carry only history/context over their existing authorized connections. */
export const synchronizeBots = Effect.fn("clientRuntime.bots.synchronize")(function* () {
  const registry = yield* Registry.EnvironmentRegistry;
  const entries = yield* SubscriptionRef.get(registry.entries);
  const connected: Array<{ environmentId: EnvironmentId; status: BotReplicationStatus }> = [];
  for (const environmentId of entries.keys()) {
    const state = yield* registry.state(environmentId).pipe(Effect.orElseSucceed(() => null));
    if (state?.phase !== "connected") continue;
    const status = yield* registry
      .run(
        environmentId,
        Effect.gen(function* () {
          const config = yield* Rpc.request(WS_METHODS.serverGetConfig, {});
          if (config.environment.capabilities.botReplication !== true) return null;
          return yield* Rpc.request(WS_METHODS.botsReplicationStatus, {});
        }),
      )
      .pipe(
        Effect.timeout("10 seconds"),
        Effect.orElseSucceed(() => null),
      );
    if (status !== null) connected.push({ environmentId, status });
  }
  if (connected.length < 2) return;
  const preferences = connected
    .map((entry) => entry.status.preferences)
    .sort((a, b) => b.revision - a.revision || (b.author ?? "").localeCompare(a.author ?? ""))[0]!;
  for (const target of connected) {
    if (
      preferences.revision > 0 &&
      (target.status.preferences.revision !== preferences.revision ||
        target.status.preferences.author !== preferences.author)
    ) {
      yield* registry
        .run(
          target.environmentId,
          withPeerAccess(
            target.environmentId,
            WS_METHODS.botsMergePreferences,
            Rpc.requestGuarded(WS_METHODS.botsMergePreferences, preferences),
          ),
        )
        .pipe(
          Effect.timeout("10 seconds"),
          Effect.catch(() => Effect.void),
        );
    }
    for (const source of connected) {
      if (source.environmentId === target.environmentId) continue;
      for (const project of source.status.projects) {
        if (!project.ready) continue;
        yield* Effect.gen(function* () {
          const previous = target.status.cursors.find(
            (entry) =>
              entry.environmentId === source.environmentId && entry.projectId === project.projectId,
          );
          let cursor: BotReplicaCursor | null = previous?.cursor ?? null;
          // Bounded work per cycle; the receiver's persisted cursor resumes large histories.
          for (let pageNumber = 0; pageNumber < 16; pageNumber++) {
            const page = yield* registry.run(
              source.environmentId,
              Rpc.request(WS_METHODS.botsReplicaRead, {
                projectId: project.projectId,
                ...(cursor ? { after: cursor } : {}),
                includeManifest: pageNumber === 0,
                ...(previous?.manifestDigest
                  ? { knownManifestDigest: previous.manifestDigest }
                  : {}),
              }),
            );
            yield* registry.run(
              target.environmentId,
              withPeerAccess(
                target.environmentId,
                WS_METHODS.botsReplicaReceive,
                Rpc.requestGuarded(WS_METHODS.botsReplicaReceive, page),
              ),
            );
            cursor = page.cursor;
            if (page.complete) break;
          }
        }).pipe(
          Effect.timeout("30 seconds"),
          Effect.catch((error) =>
            Effect.logDebug("Bot continuity will resume on the next connection cycle.", { error }),
          ),
        );
      }
    }
  }
});

export const runBotReplication = Effect.fn("clientRuntime.bots.replicationWorker")(function* () {
  yield* synchronizeBots().pipe(
    Effect.catch(() => Effect.void),
    Effect.repeat(Schedule.spaced("15 seconds")),
  );
});
