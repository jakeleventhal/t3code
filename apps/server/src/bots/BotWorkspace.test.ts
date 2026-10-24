import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as BotWorkspace from "./BotWorkspace.ts";

const layer = BotWorkspace.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.effect("initializes once and preserves edits, deletions and an intentionally empty memory", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "bot-memory-" });
    const workspace = yield* BotWorkspace.BotWorkspace;
    yield* Effect.all(
      [workspace.initialize(root, "assistant"), workspace.initialize(root, "assistant")],
      { concurrency: "unbounded" },
    );
    assert.include(yield* workspace.read(root, "assistant"), "# Saved memory");
    assert.notInclude(yield* workspace.read(root, "assistant"), "before compaction");
    yield* fs.writeFileString(path.join(root, "AGENTS.md"), "Saved memory: corrected goal is 180.");
    yield* workspace.initialize(root, "assistant");
    assert.equal(yield* workspace.read(root, "assistant"), "Saved memory: corrected goal is 180.");
    yield* fs.writeFileString(path.join(root, "AGENTS.md"), "");
    yield* workspace.initialize(root, "assistant");
    assert.equal(yield* workspace.read(root, "assistant"), "");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("keeps separate conversation briefs, including long and path-shaped thread ids", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "bot-brief-" });
    const workspace = yield* BotWorkspace.BotWorkspace;
    const thread = ThreadId.make("../nested/".repeat(100));
    const first = yield* workspace.conversation(root, thread);
    const second = yield* workspace.conversation(root, ThreadId.make("topic-2"));
    assert.notEqual(first.file, second.file);
    assert.equal(path.dirname(first.file), "conversations");
    assert.isBelow(path.basename(first.file).length, 255);
    yield* fs.makeDirectory(path.join(root, "conversations"));
    yield* fs.writeFileString(
      path.join(root, first.file),
      "Decision: reuse the imported CSV. Result: results/fitness.sqlite.",
    );
    assert.include((yield* workspace.conversation(root, thread)).text, "reuse the imported CSV");
    assert.equal((yield* workspace.conversation(root, ThreadId.make("topic-2"))).text, "");
    yield* fs.remove(path.join(root, first.file));
    assert.equal((yield* workspace.conversation(root, thread)).text, "");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("bounds instructions and briefs without splitting a Unicode character", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "bot-bounds-" });
    const workspace = yield* BotWorkspace.BotWorkspace;
    yield* fs.writeFileString(path.join(root, "AGENTS.md"), "界".repeat(10_000));
    const text = yield* workspace.read(root, "specialist");
    assert.isBelow(Buffer.byteLength(text), 8400);
    assert.notInclude(text, "\ufffd");
    assert.include(text, "More bot instructions");
    const brief = yield* workspace.conversation(root, ThreadId.make("topic"));
    yield* fs.makeDirectory(path.join(root, "conversations"));
    yield* fs.writeFileString(path.join(root, brief.file), "界".repeat(10_000));
    const next = yield* workspace.conversation(root, ThreadId.make("topic"));
    assert.isBelow(Buffer.byteLength(next.text), 4300);
    assert.notInclude(next.text, "\ufffd");
    assert.include(next.text, "Remaining conversation brief omitted");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
