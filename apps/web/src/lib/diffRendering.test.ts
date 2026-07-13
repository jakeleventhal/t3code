import { describe, expect, it } from "vite-plus/test";
import { buildPatchCacheKey, getRenderablePatch } from "./diffRendering";

describe("buildPatchCacheKey", () => {
  it("returns a stable cache key for identical content", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch)).toBe(buildPatchCacheKey(patch));
  });

  it("normalizes outer whitespace before hashing", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(`\n${patch}\n`)).toBe(buildPatchCacheKey(patch));
  });

  it("changes when diff content changes", () => {
    const before = "diff --git a/a.ts b/a.ts\n+console.log('hello')";
    const after = "diff --git a/a.ts b/a.ts\n+console.log('hello world')";

    expect(buildPatchCacheKey(before)).not.toBe(buildPatchCacheKey(after));
  });

  it("changes when cache scope changes", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch, "diff-panel:light")).not.toBe(
      buildPatchCacheKey(patch, "diff-panel:dark"),
    );
  });
});

describe("getRenderablePatch", () => {
  it("compacts partial hunk render offsets for virtualized review diffs", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "index 1111111..2222222 100644",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -48,4 +48,4 @@",
      " context",
      "-before",
      "+after",
      " context",
      " context",
      "@@ -80,3 +80,4 @@",
      " context",
      "+added",
      " context",
      " context",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "review", {
      compactPartialHunkOffsets: true,
    });
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    const file = parsed.files[0];
    expect(file?.hunks[0]?.collapsedBefore).toBe(47);
    expect(file?.hunks[0]?.unifiedLineStart).toBe(0);
    expect(file?.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
    expect(file?.hunks[1]?.unifiedLineStart).toBe(file?.hunks[0]?.unifiedLineCount);
    expect(file?.unifiedLineCount).toBe(
      file?.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0),
    );
  });

  it("retains source-file offsets for checkpoint diffs", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -48,1 +48,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "checkpoint");
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;
    expect(parsed.files[0]?.hunks[0]?.unifiedLineStart).toBe(47);
  });

  it("parses files that follow a truncated per-file patch", () => {
    const patch = [
      "diff --git a/bun.lock b/bun.lock",
      "index 1111111..2222222 100644",
      "--- a/bun.lock",
      "+++ b/bun.lock",
      "@@ -1,1 +1,10000 @@",
      "-before",
      "+partial output",
      "",
      "[truncated]",
      "diff --git a/z-after.ts b/z-after.ts",
      "index 3333333..4444444 100644",
      "--- a/z-after.ts",
      "+++ b/z-after.ts",
      "@@ -1,1 +1,1 @@",
      "-export const before = true;",
      "+export const after = true;",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "per-file-truncation", {
      compactPartialHunkOffsets: true,
    });
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;
    expect(parsed.files.map((file) => file.name)).toContain("z-after.ts");
  });
});
