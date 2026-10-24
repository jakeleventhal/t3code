import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX orchestration_v2_voice_transcript_updated_idx
    ON orchestration_v2_projection_messages (thread_id, updated_at DESC, message_id DESC)
    WHERE json_extract(payload_json, '$.voiceCall') IS NOT NULL
  `;
});
