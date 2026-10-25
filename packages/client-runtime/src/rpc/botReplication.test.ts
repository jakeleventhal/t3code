import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import {
  AuthSettingsWriteScope,
  AuthOrchestrationOperateScope,
  AuthFilesystemWriteScope,
  EMPTY_BOT_SHARED_PREFERENCES,
  EnvironmentId,
  ProjectId,
  WS_METHODS,
  type BotReplicaPage,
  type BotReplicaReadInput,
  type BotReplicaCursor,
  type BotReplicationStatus,
} from "@t3tools/contracts";
import * as Registry from "../connection/registry.ts";
import * as Supervisor from "../connection/supervisor.ts";
import { AVAILABLE_CONNECTION_STATE, BearerConnectionTarget } from "../connection/model.ts";
import type { RpcSession } from "./session.ts";
import { fetchEnvironmentSessionState } from "../state/session.ts";
import { synchronizeBots } from "./botReplication.ts";

vi.mock("../state/session.ts", () => ({ fetchEnvironmentSessionState: vi.fn() }));
class TestConnectionDropped extends Data.TaggedError("TestConnectionDropped") {}

it.effect(
  "resumes persisted pages after a lost connection and does no delivery while a peer is offline",
  () =>
    Effect.gen(function* () {
      const source = EnvironmentId.make("source");
      const target = EnvironmentId.make("target");
      const projectId = ProjectId.make("bot");
      let cursor: BotReplicaCursor | null = null;
      let failNextPage = true;
      let offline = false;
      const reads: BotReplicaReadInput[] = [];
      const received: number[] = [];
      const supervisors = new Map<EnvironmentId, Supervisor.EnvironmentSupervisor["Service"]>();
      const scopes = [
        AuthSettingsWriteScope,
        AuthOrchestrationOperateScope,
        AuthFilesystemWriteScope,
      ];
      vi.mocked(fetchEnvironmentSessionState).mockReturnValue(
        Effect.succeed({
          authenticated: true,
          scopes,
          permissions: scopes,
          auth: {
            policy: "remote-reachable",
            bootstrapMethods: [],
            sessionMethods: [],
            sessionCookieName: "test",
          },
        }),
      );
      for (const id of [source, target]) {
        const session = {
          client: {
            [WS_METHODS.serverGetConfig]: () =>
              Effect.succeed({ environment: { capabilities: { botReplication: true } } }),
            [WS_METHODS.botsReplicationStatus]: () =>
              Effect.sync((): BotReplicationStatus => ({
                preferences: EMPTY_BOT_SHARED_PREFERENCES,
                projects: id === source ? [{ projectId, ready: true }] : [],
                cursors:
                  cursor && id === target
                    ? [{ environmentId: source, projectId, cursor, manifestDigest: "known" }]
                    : [],
              })),
            [WS_METHODS.botsReplicaRead]: (input: BotReplicaReadInput) =>
              Effect.sync((): BotReplicaPage => {
                reads.push(input);
                const sequence = (input.after?.sequence ?? 0) + 1;
                return {
                  environmentId: source,
                  projectId,
                  after: input.after ?? null,
                  cursor: { sequence },
                  complete: sequence === 2,
                  manifest: null,
                  manifestDigest: "known",
                  manifestRevision: null,
                  messages: [],
                };
              }),
            [WS_METHODS.botsReplicaReceive]: (page: BotReplicaPage) =>
              Effect.gen(function* () {
                if (page.cursor?.sequence === 2 && failNextPage) {
                  failNextPage = false;
                  return yield* Effect.fail(new TestConnectionDropped());
                }
                cursor = page.cursor;
                received.push(page.cursor!.sequence);
              }),
          },
        } as unknown as RpcSession;
        supervisors.set(id, {
          target: new BearerConnectionTarget({ environmentId: id, label: id, connectionId: id }),
          session: yield* SubscriptionRef.make(Option.some(session)),
          prepared: yield* SubscriptionRef.make(Option.some({})),
        } as never);
      }
      const registry = {
        entries: yield* SubscriptionRef.make(
          new Map([
            [source, {}],
            [target, {}],
          ]),
        ),
        state: (id: EnvironmentId) =>
          Effect.succeed({
            ...AVAILABLE_CONNECTION_STATE,
            phase: offline && id === target ? "connecting" : "connected",
          }),
        run: <A, E>(
          id: EnvironmentId,
          effect: Effect.Effect<A, E, Supervisor.EnvironmentSupervisor>,
        ) =>
          effect.pipe(
            Effect.provideService(Supervisor.EnvironmentSupervisor, supervisors.get(id)!),
          ),
      } as unknown as Registry.EnvironmentRegistry["Service"];
      const sync = synchronizeBots().pipe(
        Effect.provideService(Registry.EnvironmentRegistry, registry),
        Effect.provideService(HttpClient.HttpClient, {} as never),
      );
      yield* sync;
      expect(received).toEqual([1]);
      offline = true;
      yield* sync;
      expect(received).toEqual([1]);
      expect(reads).toHaveLength(2);
      offline = false;
      yield* sync;
      expect(received).toEqual([1, 2]);
      expect(reads.at(-1)).toEqual({
        projectId,
        after: { sequence: 1 },
        includeManifest: true,
        knownManifestDigest: "known",
      });
    }),
);
