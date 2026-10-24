import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "071_ProjectionProjectBotMainThread",
  (it) => {
    it.effect("keeps bot identities and leaves existing conversations unbound", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 70 });
        yield* sql`INSERT INTO projection_projects (
      project_id, title, workspace_root, scripts_json, created_at, updated_at, bot_role
    ) VALUES ('fitness', 'Fitness', '/bots/fitness', '[]', '2026-10-23', '2026-10-23', 'specialist')`;
        yield* runMigrations({ toMigrationInclusive: 71 });
        const rows =
          yield* sql`SELECT title, bot_role, bot_main_thread_id FROM projection_projects WHERE project_id = 'fitness'`;
        assert.deepEqual(rows, [
          { title: "Fitness", bot_role: "specialist", bot_main_thread_id: null },
        ]);
      }),
    );
  },
);
