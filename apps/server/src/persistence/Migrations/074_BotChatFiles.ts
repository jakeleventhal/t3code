import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX orchestration_v2_chat_files_idx
    ON orchestration_v2_projection_messages (thread_id, created_at DESC, message_id DESC)
    WHERE json_array_length(payload_json, '$.attachments') > 0
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_chat_reports_idx
    ON orchestration_v2_projection_turn_items (thread_id, updated_at DESC, turn_item_id DESC)
    WHERE type = 'dynamic_tool' AND status = 'completed'
      AND json_extract(payload_json, '$.toolName') LIKE '%html_render'
  `;
});
