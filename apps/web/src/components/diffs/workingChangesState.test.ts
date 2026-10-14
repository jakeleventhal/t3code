import { describe, expect, it } from "vite-plus/test";
import { hydratePartialDiff } from "@pierre/diffs";
import { reviewPatchHunks } from "@t3tools/client-runtime/review-workspace";
import { reviewDiffEdits } from "@t3tools/client-runtime/review-diff-context";
import { getRenderablePatch } from "~/lib/diffRendering";
import {
  applyWorkingChangesMutation,
  type WorkingChangesSnapshot,
  type WorkingChangesState,
} from "./workingChangesState";

const header = "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n";
function snapshot(body: string): WorkingChangesSnapshot {
  if (!body) return { files: [], hunksByPath: new Map() };
  const patch = header + body;
  const parsed = getRenderablePatch(patch, patch);
  if (parsed?.kind !== "files") throw new Error("Invalid fixture");
  return {
    files: parsed.files,
    hunksByPath: new Map([["file.txt", reviewPatchHunks(patch)[0]!.hunks]]),
  };
}
function edits(snapshot: WorkingChangesSnapshot) {
  return snapshot.files.flatMap((file) =>
    file.hunks.flatMap((hunk) =>
      hunk.hunkContent.flatMap((content) =>
        content.type === "change"
          ? [
              ...file.deletionLines
                .slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions)
                .map((line) => `-${line.trimEnd()}`),
              ...file.additionLines
                .slice(content.additionLineIndex, content.additionLineIndex + content.additions)
                .map((line) => `+${line.trimEnd()}`),
            ]
          : [],
      ),
    ),
  );
}
const stagedAlpha = snapshot("@@ -1,3 +1,3 @@\n-alpha\n+ALPHA\n beta\n gamma\n");
const unstagedGamma = snapshot("@@ -1,3 +1,3 @@\n ALPHA\n beta\n-gamma\n+GAMMA\n");
const combined = snapshot("@@ -1,3 +1,3 @@\n-alpha\n+ALPHA\n beta\n-gamma\n+GAMMA\n");

describe("optimistic working changes", () => {
  it("composes overlapping context when a hunk moves into an already-staged file", () => {
    const current = { staged: stagedAlpha, unstaged: unstagedGamma };
    const next = applyWorkingChangesMutation(current, combined, {
      scope: "unstaged",
      paths: ["file.txt"],
      patch: unstagedGamma.hunksByPath.get("file.txt")![0]!,
    });
    expect(next.unstaged.files).toEqual([]);
    expect(edits(next.staged)).toEqual(["-alpha", "+ALPHA", "-gamma", "+GAMMA"]);
    expect(
      next.staged.files[0]?.hunks.map((hunk) => [hunk.deletionStart, hunk.additionStart]),
    ).toEqual([[1, 1]]);
    // The retained authoritative snapshot is a complete rollback, not a mutated cache.
    expect(current.staged).toBe(stagedAlpha);
    expect(current.unstaged).toBe(unstagedGamma);
    expect(edits(current.unstaged)).toEqual(["-gamma", "+GAMMA"]);
  });

  it("unstages a hunk without losing another staged edit in the same file", () => {
    const next = applyWorkingChangesMutation(
      { staged: combined, unstaged: snapshot("") },
      combined,
      {
        scope: "staged",
        paths: ["file.txt"],
        patch: unstagedGamma.hunksByPath.get("file.txt")![0]!,
      },
    );
    expect(edits(next.staged)).toEqual(["-alpha", "+ALPHA"]);
    expect(edits(next.unstaged)).toEqual(["-gamma", "+GAMMA"]);
  });

  it("keeps correct destination coordinates when unstaging an insertion before unstaged edits", () => {
    const staged = snapshot("@@ -1,3 +1,4 @@\n alpha\n+inserted\n beta\n gamma\n");
    const unstaged = snapshot("@@ -1,4 +1,4 @@\n alpha\n inserted\n beta\n-gamma\n+GAMMA\n");
    const next = applyWorkingChangesMutation({ staged, unstaged }, snapshot(""), {
      scope: "staged",
      paths: ["file.txt"],
      patch: staged.hunksByPath.get("file.txt")![0]!,
    });
    expect(next.staged.files).toEqual([]);
    expect(edits(next.unstaged)).toEqual(["+inserted", "-gamma", "+GAMMA"]);
    expect(JSON.parse(reviewDiffEdits(next.unstaged.files[0]!))).toContainEqual([
      "+",
      4,
      "GAMMA\n",
    ]);
    expect(JSON.parse(reviewDiffEdits(next.unstaged.files[0]!))).toContainEqual([
      "-",
      3,
      "gamma\n",
    ]);
  });

  it("stages selected added lines while keeping the remaining replacement unstaged", () => {
    const current: WorkingChangesState = {
      staged: snapshot(""),
      unstaged: snapshot("@@ -1,3 +1,4 @@\n alpha\n-beta\n+BETA\n+extra\n gamma\n"),
    };
    const selected = header + "@@ -1,3 +1,4 @@\n alpha\n beta\n+extra\n gamma\n";
    const next = applyWorkingChangesMutation(current, snapshot(""), {
      scope: "unstaged",
      paths: ["file.txt"],
      patch: selected,
    });
    expect(edits(next.staged)).toEqual(["+extra"]);
    expect(edits(next.unstaged)).toEqual(["-beta", "+BETA"]);
    expect(next.unstaged.files[0]?.additionLines).toEqual([
      "alpha\n",
      "BETA\n",
      "extra\n",
      "gamma\n",
    ]);
  });

  it("whole-file stage and unstage merge both scopes without dropping existing edits", () => {
    const staged = applyWorkingChangesMutation(
      { staged: stagedAlpha, unstaged: unstagedGamma },
      combined,
      { scope: "unstaged", paths: ["file.txt"] },
    );
    expect(staged.unstaged.files).toEqual([]);
    expect(edits(staged.staged)).toEqual(["-alpha", "+ALPHA", "-gamma", "+GAMMA"]);
    const unstaged = applyWorkingChangesMutation(
      { staged: stagedAlpha, unstaged: unstagedGamma },
      combined,
      { scope: "staged", paths: ["file.txt"] },
    );
    expect(unstaged.staged.files).toEqual([]);
    expect(edits(unstaged.unstaged)).toEqual(["-alpha", "+ALPHA", "-gamma", "+GAMMA"]);
  });

  it("revert removes only the unstaged entry and retains the staged snapshot", () => {
    const next = applyWorkingChangesMutation(
      { staged: stagedAlpha, unstaged: unstagedGamma },
      combined,
      { scope: "unstaged", paths: ["file.txt"], revert: true },
    );
    expect(next.unstaged.files).toEqual([]);
    expect(edits(next.staged)).toEqual(["-alpha", "+ALPHA"]);
  });

  it("keeps a staged hunk's open code region as context, alongside remaining edits", () => {
    const unstaged = snapshot(
      "@@ -10,3 +10,3 @@\n before\n-old\n+new\n after\n@@ -30,3 +30,3 @@\n other before\n-other old\n+other new\n other after\n",
    );
    const next = applyWorkingChangesMutation({ staged: snapshot(""), unstaged }, unstaged, {
      scope: "unstaged",
      paths: ["file.txt"],
      patch: unstaged.hunksByPath.get("file.txt")![0]!,
    });
    const file = next.unstaged.files[0]!;
    expect(file.hunks.map((hunk) => [hunk.additionStart, hunk.additionCount])).toEqual([
      [10, 3],
      [30, 3],
    ]);
    expect(file.hunks[0]!.hunkContent).toEqual([
      { type: "context", lines: 3, additionLineIndex: 0, deletionLineIndex: 0 },
    ]);
    expect(file.additionLines.slice(0, 3)).toEqual(["before\n", "new\n", "after\n"]);
    expect(edits(next.unstaged)).toEqual(["-other old", "+other new"]);
    expect(file.additionLines.some((line) => line.includes("\u0000unknown:"))).toBe(false);
  });

  it("keeps the open file after staging its final edit without leaving it in the unstaged tree", () => {
    const next = applyWorkingChangesMutation(
      { staged: snapshot(""), unstaged: unstagedGamma },
      combined,
      {
        scope: "unstaged",
        paths: ["file.txt"],
      },
    );
    expect(next.unstaged.files).toEqual([]);
    expect(next.unstaged.retainedFiles).toHaveLength(1);
    const file = next.unstaged.retainedFiles![0]!;
    expect(reviewDiffEdits(file)).toBe("[]");
    expect(file.additionLines).toEqual(["ALPHA\n", "beta\n", "GAMMA\n"]);
    expect(file.hunks[0]!.additionStart).toBe(1);
  });

  it("retains the same context and line mapping when staging selected lines inside a hunk", () => {
    const unstaged = snapshot("@@ -10,4 +10,5 @@\n before\n-old\n+new\n+extra\n after\n end\n");
    const next = applyWorkingChangesMutation({ staged: snapshot(""), unstaged }, unstaged, {
      scope: "unstaged",
      paths: ["file.txt"],
      patch: header + "@@ -10,4 +10,5 @@\n before\n old\n+extra\n after\n end\n",
    });
    expect(edits(next.unstaged)).toEqual(["-old", "+new"]);
    expect(next.unstaged.files[0]!.hunks[0]!.additionStart).toBe(10);
    expect(next.unstaged.files[0]!.additionLines).toEqual([
      "before\n",
      "new\n",
      "extra\n",
      "after\n",
      "end\n",
    ]);
    const authoritative = snapshot(
      "@@ -10,5 +10,5 @@\n before\n-old\n+new\n extra\n after\n end\n",
    );
    expect(reviewDiffEdits(next.unstaged.files[0]!)).toBe(reviewDiffEdits(authoritative.files[0]!));
  });

  it("preserves both open regions across consecutive writes after Git regroups the remaining patch", () => {
    const unstaged = snapshot(
      "@@ -10,3 +10,3 @@\n before\n-old\n+new\n after\n@@ -30,3 +30,3 @@\n other before\n-other old\n+other new\n other after\n",
    );
    const first = applyWorkingChangesMutation({ staged: snapshot(""), unstaged }, unstaged, {
      scope: "unstaged",
      paths: ["file.txt"],
      patch: unstaged.hunksByPath.get("file.txt")![0]!,
    });
    const refreshed = snapshot(
      "@@ -30,3 +30,3 @@\n other before\n-other old\n+other new\n other after\n",
    );
    const second = applyWorkingChangesMutation(
      {
        staged: first.staged,
        unstaged: { ...refreshed, files: first.unstaged.files },
      },
      unstaged,
      {
        scope: "unstaged",
        paths: ["file.txt"],
        patch: refreshed.hunksByPath.get("file.txt")![0]!,
      },
    );
    expect(second.unstaged.files).toEqual([]);
    const file = second.unstaged.retainedFiles![0]!;
    expect(reviewDiffEdits(file)).toBe("[]");
    expect(file.hunks.map((hunk) => [hunk.additionStart, hunk.additionCount])).toEqual([
      [10, 3],
      [30, 3],
    ]);
    expect(file.additionLines).toEqual([
      "before\n",
      "new\n",
      "after\n",
      "other before\n",
      "other new\n",
      "other after\n",
    ]);
  });

  it("retains hydrated full contents and region indices so expanded context stays available", () => {
    const oldLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}\n`);
    const newLines = [...oldLines];
    newLines[10] = "new first\n";
    newLines[30] = "new second\n";
    const unstaged = snapshot(
      "@@ -10,3 +10,3 @@\n line 10\n-line 11\n+new first\n line 12\n@@ -30,3 +30,3 @@\n line 30\n-line 31\n+new second\n line 32\n",
    );
    hydratePartialDiff("merge", unstaged.files[0]!, {
      oldFile: { name: "file.txt", contents: oldLines.join("") },
      newFile: { name: "file.txt", contents: newLines.join("") },
    });
    const next = applyWorkingChangesMutation({ staged: snapshot(""), unstaged }, unstaged, {
      scope: "unstaged",
      paths: ["file.txt"],
      patch: unstaged.hunksByPath.get("file.txt")![0]!,
    });
    const file = next.unstaged.files[0]!;
    expect(file.isPartial).toBe(false);
    expect(file.additionLines).toEqual(newLines);
    expect(file.deletionLines[10]).toBe("new first\n");
    expect(file.deletionLines[30]).toBe("line 31\n");
    expect(file.hunks.map((hunk) => [hunk.additionStart, hunk.additionLineIndex])).toEqual([
      [10, 9],
      [30, 29],
    ]);
    expect(edits(next.unstaged)).toEqual(["-line 31", "+new second"]);
  });
});
