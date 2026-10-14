import { expect, it } from "vite-plus/test";
import { applyWorkingChangesMutation } from "@t3tools/client-runtime/review-working-changes-state";
import { reviewPatchHunks } from "@t3tools/client-runtime/review-workspace";
import { buildReviewParsedDiff } from "./reviewModel";
import {
  nativeWorkingChangesSnapshot,
  nativeWorkingChangesStateForMutation,
  nativeWorkingReaderFiles,
  nativeWorkingRenderableFile,
} from "./workingChangesProjection";

const header =
  "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n";
const first = "@@ -1,4 +1,4 @@\n before\n-oldFirst\n+newFirst\n after\n last\n";
const second = "@@ -10,3 +10,3 @@\n ten\n-oldSecond\n+newSecond\n twelve\n";
function snapshot(patch: string) {
  const parsed = buildReviewParsedDiff(patch, "native-test");
  if (parsed.kind !== "files") throw new Error("Expected a native diff");
  return nativeWorkingChangesSnapshot(
    parsed.files,
    new Map(reviewPatchHunks(patch).map((file) => [parsed.files[0]!.path, file.hunks])),
  );
}

it("keeps both native code regions after staging a hunk and after Git confirms it", () => {
  const unstaged = snapshot(header + first + second);
  const state = { staged: { files: [], hunksByPath: new Map() }, unstaged };
  const next = applyWorkingChangesMutation(state, unstaged, {
    scope: "unstaged",
    paths: ["src/example.ts"],
    patch: header + first,
  });
  const projected = nativeWorkingReaderFiles(next.unstaged, next.unstaged).map((file) =>
    nativeWorkingRenderableFile(file),
  );
  const refreshed = nativeWorkingReaderFiles(snapshot(header + second), next.unstaged).map((file) =>
    nativeWorkingRenderableFile(file),
  );
  for (const files of [projected, refreshed]) {
    expect(files[0]!.id).toBe("src/example.ts");
    const lines = files[0]!.rows.filter((row) => row.kind === "line");
    expect(lines.find((row) => row.content === "newFirst")?.change).toBe("context");
    expect(lines.some((row) => row.content === "oldFirst")).toBe(false);
    expect(lines.find((row) => row.content === "newSecond")?.change).toBe("add");
    expect(lines.find((row) => row.content === "oldSecond")?.change).toBe("delete");
    expect(lines.some((row) => row.content === "before")).toBe(true);
    expect(lines.some((row) => row.content === "twelve")).toBe(true);
  }
});

it("clears whole-file changes in the same native reader instead of switching to staged", () => {
  const unstaged = snapshot(header + first + second);
  const next = applyWorkingChangesMutation(
    { staged: { files: [], hunksByPath: new Map() }, unstaged },
    unstaged,
    { scope: "unstaged", paths: ["src/example.ts"] },
  );
  const files = nativeWorkingReaderFiles({ files: [], hunksByPath: new Map() }, next.unstaged).map(
    (file) => nativeWorkingRenderableFile(file),
  );
  expect(files.map((file) => file.id)).toEqual(["src/example.ts"]);
  expect(files[0]!.additions).toBe(0);
  expect(files[0]!.deletions).toBe(0);
  const lines = files[0]!.rows.filter((row) => row.kind === "line");
  expect(lines.every((row) => row.change === "context")).toBe(true);
  expect(lines.map((row) => row.content)).toContain("newFirst");
  expect(lines.map((row) => row.content)).toContain("newSecond");
});

it("keeps an earlier cleared region when staging again after confirmation", () => {
  const unstaged = snapshot(header + first + second);
  const initial = { staged: { files: [], hunksByPath: new Map() }, unstaged };
  const firstStage = applyWorkingChangesMutation(initial, unstaged, {
    scope: "unstaged",
    paths: ["src/example.ts"],
    patch: header + first,
  });
  const confirmed = { staged: snapshot(header + first), unstaged: snapshot(header + second) };
  const retained = nativeWorkingChangesStateForMutation(confirmed, firstStage);
  const secondStage = applyWorkingChangesMutation(retained, retained.unstaged, {
    scope: "unstaged",
    paths: ["src/example.ts"],
    patch: header + second,
  });
  const file = nativeWorkingRenderableFile(
    nativeWorkingReaderFiles({ files: [], hunksByPath: new Map() }, secondStage.unstaged)[0]!,
  );
  const lines = file.rows.filter((row) => row.kind === "line");
  expect(lines.filter((row) => row.content === "newFirst")).toHaveLength(1);
  expect(lines.filter((row) => row.content === "newSecond")).toHaveLength(1);
  expect(lines.every((row) => row.change === "context")).toBe(true);
  expect(lines.some((row) => row.content === "before")).toBe(true);
});
