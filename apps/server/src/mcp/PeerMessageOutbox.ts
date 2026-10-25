import {
  CommandId,
  EnvironmentId,
  ThreadId,
  PeerMessageOutboxError,
  PeerMessageOutboxItem,
  PeerEnvironmentThreadSendInput,
  OrchestratorMcpThreadSendResult,
  type PeerMessageOutboxListInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as PeerEnvironmentBroker from "./PeerEnvironmentBroker.ts";

type EnqueueInput = {
  readonly environmentId: EnvironmentId;
  readonly sourceThreadId: ThreadId | null;
  readonly sourceTitle: string;
  readonly input: PeerEnvironmentThreadSendInput;
};

export class PeerMessageOutbox extends Context.Service<
  PeerMessageOutbox,
  {
    readonly enqueue: (
      input: EnqueueInput,
    ) => Effect.Effect<PeerMessageOutboxItem, PeerMessageOutboxError>;
    readonly list: (
      input: PeerMessageOutboxListInput,
    ) => Effect.Effect<ReadonlyArray<PeerMessageOutboxItem>, PeerMessageOutboxError>;
    readonly cancel: (
      requestId: CommandId,
    ) => Effect.Effect<PeerMessageOutboxItem, PeerMessageOutboxError>;
    readonly flush: (environmentId?: EnvironmentId) => Effect.Effect<void, PeerMessageOutboxError>;
  }
>()("t3/mcp/PeerMessageOutbox") {}

interface Row {
  request_id: string;
  source_thread_id: string | null;
  source_title: string;
  environment_id: string;
  thread_id: string;
  input_json: string;
  status: string;
  uncertain: number;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const decodeInput = Schema.decodeUnknownSync(Schema.fromJsonString(PeerEnvironmentThreadSendInput));
const decodeResult = Schema.decodeUnknownSync(
  Schema.fromJsonString(OrchestratorMcpThreadSendResult),
);
const decodeItem = Schema.decodeUnknownSync(PeerMessageOutboxItem);
const itemFromRow = (row: Row) =>
  decodeItem({
    requestId: row.request_id,
    sourceThreadId: row.source_thread_id,
    sourceTitle: row.source_title,
    environmentId: row.environment_id,
    threadId: row.thread_id,
    text: decodeInput(row.input_json).text.slice(0, 1000),
    status: row.status,
    uncertain: row.uncertain !== 0,
    result: row.result_json === null ? null : decodeResult(row.result_json),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

class OutboxConflict extends Schema.TaggedError<OutboxConflict>()("OutboxConflict", {
  reason: Schema.Literals(["missing", "reused_id", "delivery_uncertain"]),
}) {}
const encodeInput = Schema.encodeSync(Schema.fromJsonString(PeerEnvironmentThreadSendInput));
const encodeResult = Schema.encodeSync(Schema.fromJsonString(OrchestratorMcpThreadSendResult));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const scope = yield* Effect.scope;
  const broker = yield* PeerEnvironmentBroker.PeerEnvironmentBroker;
  const locks = yield* KeyedLock.make<string>();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const key = (row: Pick<Row, "environment_id" | "thread_id">) =>
    `${encodeURIComponent(row.environment_id)}:${encodeURIComponent(row.thread_id)}`;
  const read = Effect.fn("PeerMessageOutbox.read")(function* (requestId: CommandId) {
    const rows = yield* sql<Row>`SELECT * FROM peer_message_outbox WHERE request_id = ${requestId}`;
    if (!rows[0]) return yield* Effect.fail(new OutboxConflict({ reason: "missing" }));
    return rows[0];
  });
  const deliver = Effect.fn("PeerMessageOutbox.deliver")(function* (row: Row) {
    const earlier = yield* sql`SELECT request_id FROM peer_message_outbox
      WHERE environment_id = ${row.environment_id} AND thread_id = ${row.thread_id}
      AND status IN ('pending', 'sending', 'blocked')
      ORDER BY rowid LIMIT 1`;
    if (earlier[0]?.request_id !== row.request_id) return false;
    // Persist uncertainty before the network call. A crash or lost acknowledgement must reuse
    // this command id, and must not offer cancellation of work that may already have started.
    yield* sql`UPDATE peer_message_outbox SET status = 'sending', uncertain = 1,
      updated_at = ${yield* now} WHERE request_id = ${row.request_id}`;
    const answer = yield* broker
      .invoke({
        operation: "thread_send",
        environmentId: EnvironmentId.make(row.environment_id),
        input: decodeInput(row.input_json),
      })
      .pipe(Effect.result);
    if (answer._tag === "Success") {
      yield* sql`UPDATE peer_message_outbox SET status = 'delivered', uncertain = 0,
        result_json = ${encodeResult(answer.success.result)}, error = NULL,
        updated_at = ${yield* now} WHERE request_id = ${row.request_id}`;
      return true;
    }
    const error = answer.failure;
    const blocked =
      error.code === "environment_unauthorized" || error.code === "environment_incompatible";
    // The carrier may have disconnected after dispatch. Even a later offline answer cannot
    // disprove delivery of an earlier attempt; retain that uncertainty until replay succeeds.
    const definitelyNotSent = row.uncertain === 0 && error.deliveryUncertain !== true;
    yield* sql`UPDATE peer_message_outbox SET status = ${blocked ? "blocked" : "pending"},
      uncertain = ${definitelyNotSent ? 0 : 1}, error = ${error.code},
      updated_at = ${yield* now} WHERE request_id = ${row.request_id}`;
    return false;
  });
  const flush = Effect.fn("PeerMessageOutbox.flush")(
    function* (environmentId: EnvironmentId | undefined, threadId: ThreadId | undefined) {
      const rows = yield* sql<Row>`SELECT * FROM peer_message_outbox
      WHERE status IN ('pending', 'sending', 'blocked')
      AND (${environmentId ?? null} IS NULL OR environment_id = ${environmentId ?? null})
      AND (${threadId ?? null} IS NULL OR thread_id = ${threadId ?? null}) ORDER BY rowid`;
      const destinations = new Map(rows.map((row) => [key(row), row]));
      yield* Effect.forEach(
        destinations.entries(),
        ([destination, row]) =>
          locks.withLock(
            destination,
            Effect.gen(function* () {
              const pending = yield* sql<Row>`SELECT * FROM peer_message_outbox
          WHERE environment_id = ${row.environment_id} AND thread_id = ${row.thread_id}
          AND status IN ('pending', 'sending', 'blocked') ORDER BY rowid`;
              for (const entry of pending) if (!(yield* deliver(entry))) break;
            }),
          ),
        { concurrency: 4, discard: true },
      );
    },
    Effect.mapError((cause) => new PeerMessageOutboxError({ operation: "deliver", cause })),
  );
  return PeerMessageOutbox.of({
    flush: (environmentId) => flush(environmentId, undefined),
    enqueue: Effect.fn("PeerMessageOutbox.enqueue")(
      function* (input) {
        const at = yield* now;
        yield* sql`INSERT INTO peer_message_outbox
        (request_id, source_thread_id, source_title, environment_id, thread_id, input_json, status, created_at, updated_at)
        VALUES (${input.input.commandId}, ${input.sourceThreadId}, ${input.sourceTitle.slice(0, 200)},
          ${input.environmentId}, ${input.input.threadId}, ${encodeInput(input.input)}, 'pending', ${at}, ${at})
        ON CONFLICT(request_id) DO NOTHING`;
        const row = yield* read(input.input.commandId);
        if (
          row.environment_id !== input.environmentId ||
          row.input_json !== encodeInput(input.input)
        ) {
          return yield* Effect.fail(new OutboxConflict({ reason: "reused_id" }));
        }
        yield* locks.withLock(
          key(row),
          Effect.gen(function* () {
            const current = yield* read(input.input.commandId);
            if (current.status !== "delivered" && current.status !== "cancelled")
              yield* deliver(current);
          }),
        );
        return itemFromRow(yield* read(input.input.commandId));
      },
      Effect.mapError((cause) => new PeerMessageOutboxError({ operation: "enqueue", cause })),
    ),
    list: Effect.fn("PeerMessageOutbox.list")(
      function* (input) {
        const recent = DateTime.formatIso(DateTime.subtract(yield* DateTime.now, { hours: 1 }));
        const rows = yield* sql<Row>`SELECT * FROM peer_message_outbox
        WHERE (status IN ('pending', 'sending', 'blocked') OR updated_at >= ${recent})
        AND (${input.sourceThreadId ?? null} IS NULL OR source_thread_id = ${input.sourceThreadId ?? null})
        AND (${input.environmentId ?? null} IS NULL OR environment_id = ${input.environmentId ?? null})
        AND (${input.threadId ?? null} IS NULL OR thread_id = ${input.threadId ?? null})
        ORDER BY CASE WHEN status IN ('pending', 'sending', 'blocked') THEN 0 ELSE 1 END,
          CASE WHEN status IN ('pending', 'sending', 'blocked') THEN rowid END ASC, rowid DESC LIMIT 100`;
        return rows.map(itemFromRow);
      },
      Effect.mapError((cause) => new PeerMessageOutboxError({ operation: "list", cause })),
    ),
    cancel: Effect.fn("PeerMessageOutbox.cancel")(
      function* (requestId) {
        const row = yield* read(requestId);
        const cancelled = yield* locks.withLock(
          key(row),
          Effect.gen(function* () {
            const current = yield* read(requestId);
            if (current.uncertain !== 0 || current.status === "delivered") {
              return yield* Effect.fail(new OutboxConflict({ reason: "delivery_uncertain" }));
            }
            yield* sql`UPDATE peer_message_outbox SET status = 'cancelled', updated_at = ${yield* now}
          WHERE request_id = ${requestId}`;
            return itemFromRow(yield* read(requestId));
          }),
        );
        yield* flush(EnvironmentId.make(row.environment_id), ThreadId.make(row.thread_id)).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not resume queued bot requests after cancellation", { cause }),
          ),
          Effect.forkIn(scope),
        );
        return cancelled;
      },
      Effect.mapError((cause) => new PeerMessageOutboxError({ operation: "cancel", cause })),
    ),
  });
});
export const layer = Layer.effect(PeerMessageOutbox, make);
