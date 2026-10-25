import {
  CommandId,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  WS_METHODS,
  type PeerMessageOutboxItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createPeerRequestAtoms,
  peerRequestListTargets,
  peerRequestRows,
  type PeerRequestEntry,
} from "./peerRequests.ts";

const source = EnvironmentId.make("source");
const destination = EnvironmentId.make("destination");
const other = EnvironmentId.make("other");
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const at = (offsetMs: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + offsetMs));

function item(
  requestId: string,
  patch: Partial<PeerMessageOutboxItem> = {},
): PeerMessageOutboxItem {
  return {
    requestId: CommandId.make(requestId),
    sourceThreadId: ThreadId.make("asker"),
    sourceTitle: "Asker",
    environmentId: destination,
    threadId: ThreadId.make("helper"),
    text: "Please look at the build",
    createdAt: at(-60_000),
    updatedAt: at(-60_000),
    status: "pending",
    uncertain: false,
    result: null,
    error: null,
    ...patch,
  };
}

const outgoing = (value: PeerMessageOutboxItem): PeerRequestEntry => ({
  hostEnvironmentId: source,
  direction: "outgoing",
  item: value,
});
const incoming = (value: PeerMessageOutboxItem): PeerRequestEntry => ({
  hostEnvironmentId: source,
  direction: "incoming",
  item: value,
});

const delivered = (requestId: string, patch: Partial<PeerMessageOutboxItem> = {}) =>
  item(requestId, {
    status: "delivered",
    updatedAt: at(-30_000),
    result: {
      threadId: ThreadId.make("helper"),
      messageId: MessageId.make(`message:${requestId}`),
      runId: RunId.make(`run:${requestId}`),
      status: "running",
      delivery: "started",
    },
    ...patch,
  });

describe("peerRequestListTargets", () => {
  it("reads its own requests from its host and requests to it from every other host", () => {
    expect(
      peerRequestListTargets({
        environmentId: destination,
        threadId: ThreadId.make("helper"),
        outgoing: false,
        sourceEnvironmentIds: [other, destination, source, other],
      }),
    ).toEqual([
      {
        environmentId: other,
        direction: "incoming",
        input: { environmentId: destination, threadId: ThreadId.make("helper") },
      },
      {
        environmentId: source,
        direction: "incoming",
        input: { environmentId: destination, threadId: ThreadId.make("helper") },
      },
    ]);
  });
});

describe("peerRequestRows", () => {
  it("only offers cancel for a request that certainly never left", () => {
    const rows = peerRequestRows(
      [
        outgoing(item("waiting")),
        outgoing(item("sending", { status: "sending", uncertain: true })),
        outgoing(item("retrying", { status: "pending", uncertain: true })),
        outgoing(item("access", { status: "blocked", error: "environment_unauthorized" })),
        outgoing(
          item("setup", {
            status: "blocked",
            uncertain: true,
            error: "environment_incompatible",
          }),
        ),
      ],
      NOW,
    );
    expect(rows.map((row) => [row.item.requestId, row.state, row.canCancel])).toEqual([
      ["waiting", "waiting", true],
      ["sending", "confirming", false],
      ["retrying", "confirming", false],
      ["access", "access", true],
      ["setup", "setup", false],
    ]);
    expect(rows[4]?.detail).toContain("may already have arrived");
  });

  it("lists waiting requests oldest first, then recent deliveries that had to wait", () => {
    const rows = peerRequestRows(
      [
        outgoing(item("newer", { createdAt: at(-10_000) })),
        outgoing(item("older", { createdAt: at(-20_000) })),
        outgoing(delivered("waited", { createdAt: at(-120_000) })),
        outgoing(delivered("immediate", { createdAt: at(-30_000) })),
        outgoing(
          delivered("stale", { createdAt: at(-3 * 3_600_000), updatedAt: at(-2 * 3_600_000) }),
        ),
        outgoing(item("cancelled", { status: "cancelled" })),
      ],
      NOW,
    );
    expect(rows.map((row) => row.item.requestId)).toEqual(["older", "newer", "waited"]);
  });

  it("leaves delivered requests out of the receiving conversation, which shows the work itself", () => {
    expect(
      peerRequestRows(
        [incoming(delivered("waited", { createdAt: at(-120_000) })), incoming(item("waiting"))],
        NOW,
      ).map((row) => row.item.requestId),
    ).toEqual(["waiting"]);
  });

  it("shows a request once even if two reads return it", () => {
    const entry = outgoing(item("same"));
    expect(peerRequestRows([entry, entry], NOW)).toHaveLength(1);
  });
});

/** One connected host whose outbox list answers with whatever `items` holds at the time. */
const connectedSourceHost = Effect.fn("TestPeerRequests.connectedSourceHost")(function* (
  items: () => ReadonlyArray<PeerMessageOutboxItem>,
) {
  const client = {
    [WS_METHODS.peerMessagesList]: () => Effect.sync(items),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    client,
    initialConfig: Effect.never,
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: new PrimaryConnectionTarget({
      environmentId: source,
      label: "Source",
      httpBaseUrl: "https://source.example.test",
      wsBaseUrl: "wss://source.example.test",
    }),
    state: yield* SubscriptionRef.make<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      desired: true,
      network: "online",
      phase: "connected",
      attempt: 1,
      generation: 1,
    }),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    _environmentId,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const registry = EnvironmentRegistry.EnvironmentRegistry.of({
    run,
    followStream,
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  return Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry));
});

describe("createPeerRequestAtoms", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.effect(
    "finds a request queued after it first read an empty list, without the conversation changing",
    () =>
      Effect.gen(function* () {
        vi.useFakeTimers();
        let queued: ReadonlyArray<PeerMessageOutboxItem> = [];
        const atoms = createPeerRequestAtoms(yield* connectedSourceHost(() => queued));
        // The receiving conversation's own host is offline; only the asker's host is read.
        const conversation = atoms.conversation({
          environmentId: destination,
          threadId: ThreadId.make("helper"),
          outgoing: false,
          sourceEnvironmentIds: [source],
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
          Effect.sync(() => registry.dispose()),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() => registry.mount(conversation)),
          (unmount) => Effect.sync(unmount),
        );

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(registry.get(conversation)).toEqual([]);

        queued = [item("later")];
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(15_000));
        expect(registry.get(conversation).map((entry) => entry.item.requestId)).toEqual(["later"]);
      }).pipe(Effect.scoped),
  );
});
