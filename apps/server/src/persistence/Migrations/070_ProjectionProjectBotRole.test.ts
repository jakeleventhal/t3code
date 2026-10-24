import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("070_ProjectionProjectBotRole", (it) => {
  it.effect("preserves ordinary projects when adding bot roles and constrains non-null roles", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 69 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('existing', 'Code', '/work/code', '[]', '2026-10-23', '2026-10-23')
      `;

      yield* runMigrations({ toMigrationInclusive: 70 });
      const rows = yield* sql<{ readonly title: string; readonly botRole: string | null }>`
        SELECT title, bot_role AS "botRole" FROM projection_projects WHERE project_id = 'existing'
      `;
      assert.deepEqual(rows, [{ title: "Code", botRole: null }]);
      yield* sql`UPDATE projection_projects SET bot_role = 'specialist' WHERE project_id = 'existing'`;
      assert.isTrue(
        yield* Effect.isFailure(
          sql`UPDATE projection_projects SET bot_role = 'unsupported' WHERE project_id = 'existing'`,
        ),
      );
      const retained = yield* sql<{ readonly botRole: string }>`
        SELECT bot_role AS "botRole" FROM projection_projects WHERE project_id = 'existing'
      `;
      assert.equal(retained[0]?.botRole, "specialist");
    }),
  );
});
