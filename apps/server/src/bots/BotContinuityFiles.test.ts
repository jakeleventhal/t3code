import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BOT_CONTINUITY_FILE_BYTES, BotId, EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Continuity from "./BotContinuityFiles.ts";

const botId = BotId.make("assistant");
const environmentId = EnvironmentId.make("jakebook");
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "bot-continuity-" });
  const source = path.join(root, "source");
  yield* fs.makeDirectory(path.join(source, ".agents", "skills", "workout"), { recursive: true });
  yield* fs.writeFileString(path.join(source, "AGENTS.md"), "Prefer short workouts.");
  yield* fs.writeFileString(
    path.join(source, ".agents", "skills", "workout", "SKILL.md"),
    "Keep rest times short.",
  );
  return { fs, path, root, source };
});

it.effect("carries instructions, memory and skills without copying an uploaded ZIP", () =>
  Effect.gen(function* () {
    const { fs, path, root, source } = yield* fixture;
    yield* fs.writeFile(
      path.join(source, "upload.zip"),
      new Uint8Array(BOT_CONTINUITY_FILE_BYTES * 2),
    );
    yield* fs.makeDirectory(path.join(source, "memory"));
    yield* fs.writeFileString(
      path.join(source, "memory", "preferences.md"),
      "Three days per week.",
    );
    yield* fs.makeDirectory(path.join(source, "conversations"));
    yield* fs.writeFileString(
      path.join(source, "conversations", "main.md"),
      "Next: discuss the plan.",
    );
    const snapshot = yield* Continuity.capture({ botId, environmentId, workspaceRoot: source });
    assert.deepEqual(snapshot.files.map((file) => file.path).sort(), [
      ".agents/skills/workout/SKILL.md",
      "AGENTS.md",
      "conversations/main.md",
      "memory/preferences.md",
    ]);
    const destination = yield* Continuity.materialize(path.join(root, "backup"), snapshot);
    assert.equal(
      yield* fs.readFileString(path.join(destination, "AGENTS.md")),
      "Prefer short workouts.",
    );
    assert.equal(
      yield* fs.readFileString(path.join(destination, ".agents/skills/workout/SKILL.md")),
      "Keep rest times short.",
    );
    assert.equal(yield* fs.exists(path.join(destination, "upload.zip")), false);
    assert.equal(yield* fs.exists(path.join(source, "upload.zip")), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps a large skill resource on its original machine without blocking continuity", () =>
  Effect.gen(function* () {
    const { fs, path, root, source } = yield* fixture;
    const relative = ".agents/skills/workout/reference.zip";
    yield* fs.writeFile(path.join(source, relative), new Uint8Array(BOT_CONTINUITY_FILE_BYTES + 1));
    const snapshot = yield* Continuity.capture({ botId, environmentId, workspaceRoot: source });
    assert.deepEqual(snapshot.localFiles, [
      { environmentId, path: relative, size: BOT_CONTINUITY_FILE_BYTES + 1 },
    ]);
    const destination = yield* Continuity.materialize(path.join(root, "backup"), snapshot);
    assert.equal(yield* fs.exists(path.join(destination, relative)), false);
    assert.equal(yield* fs.exists(path.join(destination, "AGENTS.md")), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects linked instructions and unsafe or colliding imported paths", () =>
  Effect.gen(function* () {
    const { fs, path, root, source } = yield* fixture;
    yield* fs.remove(path.join(source, "AGENTS.md"));
    yield* fs.writeFileString(path.join(root, "outside"), "private");
    yield* fs.symlink(path.join(root, "outside"), path.join(source, "AGENTS.md"));
    yield* Continuity.capture({ botId, environmentId, workspaceRoot: source }).pipe(Effect.flip);
    for (const files of [
      [{ path: "../AGENTS.md", text: "wrong" }],
      [{ path: "upload.zip", text: "wrong" }],
      [
        { path: "skills/File.md", text: "one" },
        { path: "skills/file.md", text: "two" },
      ],
    ]) {
      yield* Continuity.materialize(path.join(root, "backup"), {
        version: 1,
        botId,
        files,
        localFiles: [],
      }).pipe(Effect.flip);
    }
    assert.equal(yield* fs.exists(path.join(root, "backup")), false);
    assert.equal(yield* fs.readFileString(path.join(root, "outside")), "private");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
