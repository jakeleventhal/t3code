import { describe, expect, it } from "vite-plus/test";

import { classifyMarkdownImageSource, markdownLinkMediaKind } from "./markdownImages.js";

describe("markdownLinkMediaKind", () => {
  it.each([
    ["/tmp/shot.png", "image"],
    ["images/shot.webp", "image"],
    ["C:\\shots\\shot.png", "image"],
    ["file:///tmp/recording.mp4", "video"],
    ["https://cdn.example.com/clip.mov?sig=1", "video"],
    ["<https://cdn.example.com/login page.png>", "image"],
    ["//cdn.example.com/shot.png", "image"],
  ])("classifies %s as %s", (target, kind) => {
    expect(markdownLinkMediaKind(target)).toBe(kind);
  });

  it.each([
    "/tmp/report.pdf",
    "https://example.com/docs",
    "vscode://file/tmp/shot.png",
    "t3-citation://v1/env/thread/msg?quote=shot.png",
    "mailto:someone@example.com/shot.png",
  ])("rejects %s", (target) => {
    expect(markdownLinkMediaKind(target)).toBeNull();
  });
});

describe("classifyMarkdownImageSource", () => {
  it.each([
    ["images/result.png", "/workspace/project", "/workspace/project/images/result.png"],
    [
      "images\\result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    ["file:///workspace/project/image%20one.png", null, "/workspace/project/image one.png"],
    ["file://server/share/image.png", "\\\\server\\share", "\\\\server\\share\\image.png"],
  ])("maps %s to a workspace file", (source, workspaceRoot, path) => {
    expect(classifyMarkdownImageSource(source, workspaceRoot)).toEqual({
      _tag: "WorkspaceFile",
      path,
    });
  });

  it.each(["image.png", "javascript:alert(1)", "file://%"])(
    "blocks unsupported or unresolved source %s",
    (source) => {
      expect(classifyMarkdownImageSource(source)).toEqual({ _tag: "Blocked" });
    },
  );

  // Loading these makes Windows send the user's NTLM credentials to the named host.
  it.each([
    "file://attacker.test/share/cat.jpg",
    "\\\\attacker.test\\share\\cat.jpg",
    "/\\attacker.test\\share\\cat.jpg",
    "file:/%5Cattacker.test%5Cshare%5Ccat.jpg",
    "\\\\server\\other\\cat.jpg",
  ])("blocks network path %s outside the project", (source) => {
    expect(classifyMarkdownImageSource(source, "\\\\server\\share\\project")).toEqual({
      _tag: "Blocked",
    });
  });
});
