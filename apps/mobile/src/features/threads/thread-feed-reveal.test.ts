import { MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { planThreadFeedReveal, THREAD_FEED_REVEAL_MAX_PAGES } from "./thread-feed-reveal";

function message(id: string, runId: string | null = null): ThreadFeedEntry {
  const createdAt = "2026-10-20T10:00:00.000Z";
  return {
    type: "message",
    id,
    createdAt,
    message: {
      id: MessageId.make(id),
      role: "user",
      text: id,
      attachments: [],
      runId: runId === null ? null : RunId.make(runId),
      streaming: false,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread"),
      createdAt,
      updatedAt: createdAt,
    },
  };
}

function htmlRender(threadId: string, itemId: string): ThreadFeedEntry {
  return {
    type: "html-render",
    id: `html-render:local:${threadId}:${itemId}`,
    createdAt: "2026-10-20T10:00:00.000Z",
    runId: null,
  } as ThreadFeedEntry;
}

const history = { hasMoreHistory: true, loading: false, error: null };
const target = { key: "k", messageId: "wanted", turnItemId: null };

describe("planThreadFeedReveal", () => {
  it("scrolls to a visible message or html render", () => {
    const feed = [message("a"), message("wanted")];
    expect(
      planThreadFeedReveal({
        target,
        feed,
        presented: feed,
        expandedRunIds: new Set(),
        history,
        requestedPages: new Set(),
      }),
    ).toEqual({ type: "scroll", index: 1 });
    const renders = [message("a"), htmlRender("thread", "item-1")];
    expect(
      planThreadFeedReveal({
        target: { key: "k", messageId: null, turnItemId: "item-1" },
        feed: renders,
        presented: renders,
        expandedRunIds: new Set(),
        history,
        requestedPages: new Set(),
      }),
    ).toEqual({ type: "scroll", index: 1 });
  });

  it("opens the fold hiding a loaded message once", () => {
    const input = {
      target,
      feed: [message("a"), message("wanted", "run-1")],
      presented: [message("a")],
      history,
      requestedPages: new Set<string>(),
    };
    expect(planThreadFeedReveal({ ...input, expandedRunIds: new Set() })).toEqual({
      type: "expand",
      runId: RunId.make("run-1"),
    });
    expect(
      planThreadFeedReveal({ ...input, expandedRunIds: new Set([RunId.make("run-1")]) }),
    ).toEqual({ type: "unavailable" });
  });

  it("pages in older history one page at a time and stops at the limits", () => {
    const feed = [message("newest")];
    const base = { target, feed, presented: feed, expandedRunIds: new Set<RunId>() };
    expect(planThreadFeedReveal({ ...base, history, requestedPages: new Set() })).toEqual({
      type: "load-earlier",
      cursor: "newest",
    });
    // The requested page has not landed yet.
    expect(planThreadFeedReveal({ ...base, history, requestedPages: new Set(["newest"]) })).toEqual(
      { type: "wait" },
    );
    expect(
      planThreadFeedReveal({
        ...base,
        history: { ...history, error: "offline" },
        requestedPages: new Set(["newest"]),
      }),
    ).toEqual({ type: "unavailable" });
    expect(
      planThreadFeedReveal({
        ...base,
        history: { ...history, hasMoreHistory: false },
        requestedPages: new Set(),
      }),
    ).toEqual({ type: "unavailable" });
    const exhausted = new Set(
      Array.from({ length: THREAD_FEED_REVEAL_MAX_PAGES }, (_, index) => `page-${index}`),
    );
    expect(planThreadFeedReveal({ ...base, history, requestedPages: exhausted })).toEqual({
      type: "unavailable",
    });
  });
});
