import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE peer_message_outbox (
    request_id TEXT PRIMARY KEY,
    source_thread_id TEXT,
    source_title TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL,
    uncertain INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX peer_message_outbox_delivery_idx
    ON peer_message_outbox(environment_id, thread_id, created_at, request_id)
    WHERE status IN ('pending', 'sending', 'blocked')`;
  yield* sql`CREATE INDEX peer_message_outbox_source_idx
    ON peer_message_outbox(source_thread_id, created_at DESC)`;
});
