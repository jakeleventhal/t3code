import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX orchestration_v2_voice_calls_active_idx
    ON orchestration_v2_projection_turn_items (status, turn_item_id)
    WHERE type = 'voice_call'
  `;
  yield* sql`
    CREATE UNIQUE INDEX orchestration_v2_voice_transcript_ordinal_idx
    ON orchestration_v2_projection_messages (
      thread_id,
      json_extract(payload_json, '$.voiceCall.callId'),
      json_extract(payload_json, '$.voiceCall.ordinal')
    )
    WHERE json_extract(payload_json, '$.voiceCall.callId') IS NOT NULL
  `;
  // A long call must not make every sidebar read scan past all its spoken lines.
  yield* sql`
    CREATE INDEX orchestration_v2_user_turn_messages_idx
    ON orchestration_v2_projection_messages (thread_id, updated_at DESC, message_id DESC)
    WHERE role = 'user' AND json_extract(payload_json, '$.voiceCall') IS NULL
  `;
});
