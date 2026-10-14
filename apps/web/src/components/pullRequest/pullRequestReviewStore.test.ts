import { beforeEach, describe, expect, it } from "vite-plus/test";
import { ProjectId, type PullRequestReviewThread } from "@t3tools/contracts";

import {
  mergePendingReviewComments,
  type PendingReviewComment,
  pullRequestReviewKey,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

function comment(id: string, body = id): PendingReviewComment {
  return { id, body, path: "src/app.ts", position: { kind: "added", newLine: 1 } };
}

function hostedThread(pending = true): PullRequestReviewThread {
  return {
    id: "thread",
    path: "src/app.ts",
    line: 1,
    side: "right",
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        id: "remote",
        author: null,
        body: "remote",
        createdAt: "2026-10-14T16:00:00Z",
        url: "https://github.com/owner/repo/pull/7/changes#r1",
        ...(pending ? { pendingReviewId: "review" } : {}),
      },
    ],
  };
}

describe("pull request review drafts", () => {
  beforeEach(() => {
    usePullRequestReviewStore.setState({ drafts: {}, summaries: {}, removedHostComments: {} });
  });

  it("removes only the line comments included in a submitted snapshot", () => {
    const store = usePullRequestReviewStore.getState();
    store.addComment("review-a", comment("submitted"));
    const submittedIds =
      usePullRequestReviewStore.getState().drafts["review-a"]?.map((entry) => entry.id) ?? [];

    usePullRequestReviewStore.getState().addComment("review-a", comment("added-in-flight"));
    usePullRequestReviewStore.getState().removeComments("review-a", submittedIds);

    expect(usePullRequestReviewStore.getState().drafts["review-a"]).toEqual([
      comment("added-in-flight"),
    ]);
  });

  it("does not resurrect a removed hosted draft from a stale host snapshot", () => {
    const saved = {
      ...comment("local"),
      hostedComment: {
        reviewId: "review",
        commentId: "remote",
        url: "https://github.com/owner/repo/pull/7/changes#r1",
      },
    };
    const store = usePullRequestReviewStore.getState();
    store.addComment("review-a", saved);
    store.removeComments("review-a", [saved.id]);
    expect(usePullRequestReviewStore.getState().removedHostComments["review-a"]).toEqual([
      "remote",
    ]);
    expect(mergePendingReviewComments([saved], [hostedThread()], ["remote"])).toEqual([]);
    expect(mergePendingReviewComments([saved], [hostedThread(false)], [])).toEqual([]);
    expect(mergePendingReviewComments([saved, comment("new")], [], ["remote"])).toEqual([
      comment("new"),
    ]);
  });

  it("records remote-only removals when no local draft was ever added", () => {
    usePullRequestReviewStore.getState().removeComments("review-a", ["remote"], ["remote"]);
    expect(usePullRequestReviewStore.getState().removedHostComments["review-a"]).toEqual([
      "remote",
    ]);
    expect(usePullRequestReviewStore.getState().drafts["review-a"]).toBeUndefined();
  });

  it("keeps summary bodies isolated by review key", () => {
    const store = usePullRequestReviewStore.getState();
    store.setSummary("review-a", "Summary A");
    store.setSummary("review-b", "Summary B");
    store.clearSummary("review-a", "Summary A");

    expect(usePullRequestReviewStore.getState().summaries).toEqual({
      "review-b": "Summary B",
    });
  });

  it("keeps drafts on different hosts separate when a thread reviews the same repository and number", () => {
    const reference = {
      projectId: ProjectId.make("project-a"),
      repository: "owner/repo",
      number: 7,
    };
    const publicKey = pullRequestReviewKey({ ...reference, host: "github.com" });
    const enterpriseKey = pullRequestReviewKey({ ...reference, host: "github.example.com" });
    const store = usePullRequestReviewStore.getState();
    store.addComment(publicKey, comment("public"));
    store.setSummary(publicKey, "Public review");

    expect(usePullRequestReviewStore.getState().drafts[enterpriseKey]).toBeUndefined();
    expect(usePullRequestReviewStore.getState().summaries[enterpriseKey]).toBeUndefined();

    store.addComment(enterpriseKey, comment("enterprise"));
    store.setSummary(enterpriseKey, "Enterprise review");
    store.clear(enterpriseKey);
    store.clearSummary(enterpriseKey, "Enterprise review");

    expect(usePullRequestReviewStore.getState().drafts[publicKey]).toEqual([comment("public")]);
    expect(usePullRequestReviewStore.getState().summaries[publicKey]).toBe("Public review");
  });

  it("does not clear a summary revised while submission is in flight", () => {
    const store = usePullRequestReviewStore.getState();
    store.setSummary("review-a", "Submitted body");
    usePullRequestReviewStore.getState().setSummary("review-a", "Revised body");
    usePullRequestReviewStore.getState().clearSummary("review-a", "Submitted body");

    expect(usePullRequestReviewStore.getState().summaries["review-a"]).toBe("Revised body");
  });
});
