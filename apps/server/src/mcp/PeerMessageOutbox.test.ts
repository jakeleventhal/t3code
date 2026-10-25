import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  type PeerEnvironmentOperation,
  type PeerEnvironmentResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Broker from "./PeerEnvironmentBroker.ts";
import * as Outbox from "./PeerMessageOutbox.ts";

const environmentId = EnvironmentId.make("fitness-host");
const threadId = ThreadId.make("fitness");
const input = (id: string) => ({
  environmentId,
  sourceThreadId: ThreadId.make("main"),
  sourceTitle: "Assistant",
  input: {
    threadId,
    commandId: CommandId.make(id),
    messageId: MessageId.make(id),
    text: `Request ${id}`,
  },
});
const fixture = (initial: "offline" | "lost" | "online" = "offline") => {
  let state = initial;
  const calls: string[] = [];
  const starts = new Set<string>();
  const broker = Layer.mock(Broker.PeerEnvironmentBroker)({
    invoke: ((operation: PeerEnvironmentOperation) =>
      Effect.gen(function* () {
        if (operation.operation !== "thread_send") return yield* Effect.die("Unexpected operation");
        calls.push(operation.input.commandId);
        if (state === "offline")
          return yield* new Broker.PeerEnvironmentBrokerError({
            code: "environment_offline",
            message: "Offline",
          });
        starts.add(operation.input.commandId);
        if (state === "lost")
          return yield* new Broker.PeerEnvironmentBrokerError({
            code: "host_unavailable",
            message: "Acknowledgement lost",
            deliveryUncertain: true,
          });
        return {
          operation: "thread_send",
          result: {
            threadId,
            messageId: operation.input.messageId,
            runId: RunId.make(operation.input.commandId),
            status: "queued",
            delivery: "queued",
          },
        } satisfies PeerEnvironmentResult;
      })) as Broker.PeerEnvironmentBroker["Service"]["invoke"],
  });
  const dependencies = Layer.mergeAll(Sqlite.layerMemory, broker);
  return {
    calls,
    starts,
    dependencies,
    layer: Outbox.layer.pipe(Layer.provide(dependencies)),
    online: () => {
      state = "online";
    },
    offline: () => {
      state = "offline";
    },
  };
};

it.effect("queues offline requests, cancels without delivery and preserves FIFO", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const outbox = yield* Outbox.PeerMessageOutbox;
    const first = yield* outbox.enqueue(input("a"));
    assert.equal(first.status, "pending");
    assert.isFalse(first.uncertain);
    yield* outbox.enqueue(input("b"));
    yield* outbox.enqueue(input("c"));
    yield* outbox.cancel(CommandId.make("b"));
    f.online();
    yield* outbox.flush(environmentId);
    yield* outbox.flush(environmentId);
    assert.deepEqual([...f.starts], ["a", "c"]);
    assert.deepEqual(
      (yield* outbox.list({})).map((row) => [row.requestId, row.status]),
      [
        ["c", "delivered"],
        ["b", "cancelled"],
        ["a", "delivered"],
      ],
    );
  }).pipe(Effect.provide(f.layer));
});

it.effect("replays a lost acknowledgement with the same ids and does not falsely cancel", () => {
  const f = fixture("lost");
  return Effect.gen(function* () {
    const outbox = yield* Outbox.PeerMessageOutbox;
    const first = yield* outbox.enqueue(input("a"));
    assert.isTrue(first.uncertain);
    f.offline();
    yield* outbox.flush(environmentId);
    assert.isTrue((yield* outbox.list({}))[0]!.uncertain);
    const cancelled = yield* outbox.cancel(CommandId.make("a")).pipe(Effect.result);
    assert.equal(cancelled._tag, "Failure");
    f.online();
    yield* outbox.flush(environmentId);
    assert.deepEqual([...f.starts], ["a"]);
    assert.equal((yield* outbox.list({}))[0]!.status, "delivered");
    const count = f.calls.length;
    yield* outbox.enqueue(input("a"));
    assert.equal(f.calls.length, count);
  }).pipe(Effect.provide(f.layer));
});

it.effect("a newly constructed service recovers persisted requests", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const outbox = yield* Outbox.PeerMessageOutbox;
      yield* outbox.enqueue(input("persisted"));
    }).pipe(Effect.provide(Outbox.layer));
    f.online();
    yield* Effect.gen(function* () {
      const outbox = yield* Outbox.PeerMessageOutbox;
      yield* outbox.flush(environmentId);
      assert.equal((yield* outbox.list({}))[0]!.status, "delivered");
    }).pipe(Effect.provide(Outbox.layer));
    assert.deepEqual([...f.starts], ["persisted"]);
  }).pipe(Effect.provide(f.dependencies));
});

it.effect("concurrent retries dispatch once and a reused id cannot replace saved content", () => {
  const f = fixture("online");
  return Effect.gen(function* () {
    const outbox = yield* Outbox.PeerMessageOutbox;
    const results = yield* Effect.all(
      [outbox.enqueue(input("same")), outbox.enqueue(input("same"))],
      { concurrency: 2 },
    );
    assert.deepEqual(results[0], results[1]);
    assert.equal(f.calls.length, 1);
    const conflicting = { ...input("same"), input: { ...input("same").input, text: "Changed" } };
    assert.equal((yield* outbox.enqueue(conflicting).pipe(Effect.result))._tag, "Failure");
    assert.equal((yield* outbox.list({}))[0]!.text, "Request same");
  }).pipe(Effect.provide(f.layer));
});
