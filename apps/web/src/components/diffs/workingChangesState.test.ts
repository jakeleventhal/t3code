import { describe, expect, it } from "vite-plus/test";
import { reviewPatchHunks } from "@t3tools/client-runtime/review-workspace";
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
    ).toEqual([
      [1, 1],
      [3, 3],
    ]);
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
    expect(next.unstaged.files[0]?.hunks.at(-1)?.additionStart).toBe(4);
    expect(next.unstaged.files[0]?.hunks.at(-1)?.deletionStart).toBe(3);
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
    expect(next.unstaged.files[0]?.hunks[0]?.additionStart).toBe(2);
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
});
