import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

export const reconcilePersonalFolderMigrations = Effect.fn("reconcilePersonalFolderMigrations")(
  function* (throughId?: number) {
    if (throughId !== undefined && throughId < 78) return;
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `;
    if (!tables.some((row) => row.name === "effect_sql_migrations")) return;
    const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
      SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 78
    `;
    if (!history.some((row) => row.migration_id === 78 && row.name === "ThreadFolders")) return;
    const withRules = history.some(
      (row) => row.migration_id === 79 && row.name === "ThreadFolderRules",
    );
    const expectedTables = [
      "thread_folders",
      "thread_folder_members",
      ...(withRules ? ["thread_folder_explicit_moves"] : []),
    ];
    if (
      !history.every(
        (row) =>
          (row.migration_id === 78 && row.name === "ThreadFolders") ||
          (row.migration_id === 79 && row.name === "ThreadFolderRules"),
      ) ||
      !expectedTables.every((name) => tables.some((row) => row.name === name))
    ) {
      return yield* new Migrator.MigrationError({
        kind: "BadState",
        message: "Cannot upgrade personal folder migrations with unexpected history or schema.",
      });
    }
    // The retired personal folder build used main's later ids; retain its ledger outside main's sequence.
    yield* sql`
      CREATE TABLE IF NOT EXISTS personal_folder_migration_history (
        migration_id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME NOT NULL
      )
    `;
    yield* sql`
      INSERT INTO personal_folder_migration_history (migration_id, name, created_at)
      SELECT migration_id, name, created_at FROM effect_sql_migrations WHERE migration_id >= 78
    `;
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 78`;
  },
);
