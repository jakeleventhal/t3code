import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TRIGGER bot_replica_message_insert`;
  yield* sql`DROP TRIGGER bot_replica_message_update`;
  yield* sql`ALTER TABLE bot_replica_changes RENAME TO bot_replica_changes_old`;
  yield* sql`CREATE TABLE bot_replica_changes (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE, turn_item_id TEXT UNIQUE,
    CHECK ((message_id IS NULL) != (turn_item_id IS NULL))
  )`;
  yield* sql`INSERT INTO bot_replica_changes(sequence, message_id)
    SELECT sequence, message_id FROM bot_replica_changes_old`;
  yield* sql`DROP TABLE bot_replica_changes_old`;
  // Earlier receivers discarded call identities. Re-send the original entries once, even
  // though their timestamps have not changed, so existing copies can recover those identities.
  const entries = yield* sql<{ message_id: string }>`SELECT message_id
    FROM orchestration_v2_projection_messages WHERE json_extract(payload_json, '$.voiceCall') IS NOT NULL`;
  for (const entry of entries) {
    yield* sql`INSERT INTO bot_replica_changes(message_id) VALUES (${entry.message_id})
      ON CONFLICT(message_id) DO UPDATE SET sequence = (SELECT COALESCE(MAX(sequence), 0) + 1 FROM bot_replica_changes)`;
  }
  yield* sql`INSERT INTO bot_replica_changes(turn_item_id)
    SELECT i.turn_item_id FROM orchestration_v2_projection_turn_items i
    JOIN orchestration_v2_projection_threads t ON t.thread_id = i.thread_id
    JOIN projection_projects p ON p.project_id = t.project_id
    WHERE p.bot_role IS NOT NULL AND i.type = 'voice_call' AND i.status != 'running'
    ORDER BY i.updated_at, i.turn_item_id`;
  yield* sql`CREATE TRIGGER bot_replica_message_insert AFTER INSERT ON orchestration_v2_projection_messages
    WHEN NEW.streaming = 0 AND EXISTS (
      SELECT 1 FROM orchestration_v2_projection_threads t
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = NEW.thread_id AND p.bot_role IS NOT NULL)
    BEGIN
      INSERT INTO bot_replica_changes(message_id) VALUES (NEW.message_id)
      ON CONFLICT(message_id) DO UPDATE SET sequence = (SELECT COALESCE(MAX(sequence), 0) + 1 FROM bot_replica_changes);
    END`;
  yield* sql`CREATE TRIGGER bot_replica_message_update AFTER UPDATE ON orchestration_v2_projection_messages
    WHEN NEW.streaming = 0 AND OLD.payload_json != NEW.payload_json AND EXISTS (
      SELECT 1 FROM orchestration_v2_projection_threads t
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = NEW.thread_id AND p.bot_role IS NOT NULL)
    BEGIN
      INSERT INTO bot_replica_changes(message_id) VALUES (NEW.message_id)
      ON CONFLICT(message_id) DO UPDATE SET sequence = (SELECT COALESCE(MAX(sequence), 0) + 1 FROM bot_replica_changes);
    END`;
  yield* sql`CREATE TRIGGER bot_replica_call_insert AFTER INSERT ON orchestration_v2_projection_turn_items
    WHEN NEW.type = 'voice_call' AND NEW.status != 'running'  AND EXISTS (
      SELECT 1 FROM orchestration_v2_projection_threads t JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = NEW.thread_id AND p.bot_role IS NOT NULL)
    BEGIN
      INSERT INTO bot_replica_changes(turn_item_id) VALUES (NEW.turn_item_id)
      ON CONFLICT(turn_item_id) DO UPDATE SET sequence = (SELECT COALESCE(MAX(sequence), 0) + 1 FROM bot_replica_changes);
    END`;
  yield* sql`CREATE TRIGGER bot_replica_call_update AFTER UPDATE ON orchestration_v2_projection_turn_items
    WHEN NEW.type = 'voice_call' AND NEW.status != 'running' AND OLD.payload_json != NEW.payload_json AND EXISTS (
      SELECT 1 FROM orchestration_v2_projection_threads t JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = NEW.thread_id AND p.bot_role IS NOT NULL)
    BEGIN
      INSERT INTO bot_replica_changes(turn_item_id) VALUES (NEW.turn_item_id)
      ON CONFLICT(turn_item_id) DO UPDATE SET sequence = (SELECT COALESCE(MAX(sequence), 0) + 1 FROM bot_replica_changes);
    END`;
});
