import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bot_replica_sources (
    project_id TEXT NOT NULL, environment_id TEXT NOT NULL,
    cursor_json TEXT, manifest_revision INTEGER NOT NULL DEFAULT 0, manifest_digest TEXT, origin_created_at TEXT, ready INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project_id, environment_id)
  )`;
  yield* sql`CREATE TABLE bot_replica_manifests (
    project_id TEXT PRIMARY KEY, digest TEXT NOT NULL, revision INTEGER NOT NULL
  )`;
  yield* sql`CREATE TABLE bot_replica_files (
    project_id TEXT NOT NULL, environment_id TEXT NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL,
    PRIMARY KEY(project_id, environment_id, path)
  )`;
  yield* sql`CREATE TABLE bot_replica_messages (
    message_id TEXT PRIMARY KEY, source_environment_id TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE bot_replica_changes (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE
  )`;
  yield* sql`INSERT INTO bot_replica_changes(message_id)
    SELECT m.message_id FROM orchestration_v2_projection_messages m
    JOIN orchestration_v2_projection_threads t ON t.thread_id = m.thread_id
    JOIN projection_projects p ON p.project_id = t.project_id
    WHERE p.bot_role IS NOT NULL AND m.streaming = 0 ORDER BY m.created_at, m.message_id`;
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
});
