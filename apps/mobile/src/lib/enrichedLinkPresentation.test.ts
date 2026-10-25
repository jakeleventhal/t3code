import { describe, expect, it } from "vite-plus/test";
import type {
  ComposerContextId,
  ComposerContextRecord,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { formatComposerContextHref } from "@t3tools/shared/composerContextReferences";
import {
  enrichedContextLinkPresentation,
  enrichedLinkVariantPattern,
  enrichedSkillLinkRegex,
  enrichedThreadLinkPresentation,
  ENRICHED_INLINE_FILE_LINK_REGEX,
  threadChipTargets,
} from "./enrichedLinkPresentation";

describe("Enriched link presentation", () => {
  it("shows a bot chat's references by what they name", () => {
    const environmentId = "env-home" as EnvironmentId;
    const projectId = "t3code" as ProjectId;
    const base = { version: 1, environmentId, projectId } as const;
    const records: ComposerContextRecord[] = [
      {
        ...base,
        kind: "project",
        contextId: "project_code" as ComposerContextId,
        label: "t3code",
        title: "t3code",
        botRole: null,
      },
      {
        ...base,
        kind: "project",
        contextId: "project_bot" as ComposerContextId,
        label: "Researcher",
        title: "Researcher",
        botRole: "specialist",
      },
      ...(["image/png", "application/pdf"] as const).map((mimeType, index) => ({
        ...base,
        kind: "bot-file" as const,
        contextId: `bot-file_${index}` as ComposerContextId,
        label: "Q3 report",
        fileId: `file-${index}`,
        fileKind: "attachment" as const,
        title: "Q3 report",
        attachmentId: `attachment-${index}`,
        mimeType,
        sourceThreadId: "thread-1" as ThreadId,
      })),
    ];
    const icon = (record: ComposerContextRecord) =>
      enrichedContextLinkPresentation(
        formatComposerContextHref(record.kind, record.contextId),
        records,
      )?.icon;

    expect(records.map(icon)).toEqual([
      { kind: "chip", name: "folder" },
      { kind: "chip", name: "bot" },
      { kind: "chip", name: "image" },
      { kind: "file", name: expect.any(String) },
    ]);
  });

  it("recognizes file-shaped code without turning commands or URLs into links", () => {
    for (const path of [
      "src/app.tsx",
      "./README.md",
      "/tmp/report.md",
      "C:\\repo\\app.tsx",
      "app.tsx:12:3",
    ]) {
      expect(ENRICHED_INLINE_FILE_LINK_REGEX.test(path), path).toBe(true);
    }
    for (const text of [
      "npm run dev",
      "port:3000",
      "TODO:12",
      "example.com",
      "https://example.com/app.tsx",
      "x + y",
      "README.md",
      "/app/settings",
    ]) {
      expect(ENRICHED_INLINE_FILE_LINK_REGEX.test(text), text).toBe(false);
    }
  });

  it("only recognizes complete known skill names and escapes their punctuation", () => {
    const regex = enrichedSkillLinkRegex([{ name: "check" }, { name: "check.mobile" }]);
    expect(regex?.exec("Try $check.mobile next")?.[0]).toBe("$check.mobile");
    expect(regex?.exec("Try $check-mobile next")).toBeNull();
    expect(regex?.exec("Try $checkXmobile next")).toBeNull();
    expect(regex?.exec("prefix$check next")).toBeNull();
    expect(enrichedSkillLinkRegex([])).toBeNull();
  });

  it("matches only the complete URL, including literal regex metacharacters", () => {
    const url = "file:///workspace/app[1].tsx?line=3+4";
    const pattern = new RegExp(enrichedLinkVariantPattern(url));
    expect(pattern.test(url)).toBe(true);
    expect(pattern.test(`${url}/child`)).toBe(false);
    expect(pattern.test("file:///workspace/app1Xtsx?line=34")).toBe(false);
  });

  it("presents thread links as thread chips and leaves other links alone", () => {
    expect(enrichedThreadLinkPresentation("t3-thread://v1/thread%3Aproject%3A1")).toEqual({
      accent: "#009c96",
      icon: { kind: "chip", name: "messages-square" },
    });
    for (const href of [
      "https://github.com/example/repo/pull/7",
      "https://example.com",
      "t3-context://v1/thread/thread_1",
    ]) {
      expect(enrichedThreadLinkPresentation(href), href).toBeUndefined();
    }
  });

  it("finds each linked thread once and resolves thread records to their own environment", () => {
    const here = "env-here" as EnvironmentId;
    const there = "env-there" as EnvironmentId;
    expect(
      threadChipTargets(
        here,
        "See [A](t3-thread://v1/thread_a), [A again](t3-thread://v1/thread_a) and [B](t3-thread://v1/thread_b).",
        [
          {
            version: 1,
            contextId: "thr1" as ComposerContextId,
            kind: "thread",
            label: "C",
            environmentId: there,
            threadId: "thread_c" as ThreadId,
            title: "C",
          },
        ],
      ),
    ).toEqual([
      { href: "t3-thread://v1/thread_a", environmentId: here, threadId: "thread_a", link: true },
      { href: "t3-thread://v1/thread_b", environmentId: here, threadId: "thread_b", link: true },
      {
        href: "t3-context://v1/thread/thr1",
        environmentId: there,
        threadId: "thread_c",
        link: false,
      },
    ]);
    expect(threadChipTargets(here, "No links here.")).toEqual([]);
  });
});
