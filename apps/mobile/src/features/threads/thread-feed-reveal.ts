import type { RunId } from "@t3tools/contracts";

import type { ThreadFeedEntry } from "../../lib/threadActivity";

/** A message or turn item to bring into view once, such as the chat a bot's file came from. */
export interface ThreadFeedRevealTarget {
  /** Distinguishes two requests for the same item, so a repeat tap scrolls again. */
  readonly key: string;
  readonly messageId: string | null;
  readonly turnItemId: string | null;
}

/** Older history is paged in until the item appears, but never without limit. */
export const THREAD_FEED_REVEAL_MAX_PAGES = 20;

export type ThreadFeedRevealStep =
  | { readonly type: "scroll"; readonly index: number }
  | { readonly type: "expand"; readonly runId: RunId }
  | { readonly type: "load-earlier"; readonly cursor: string }
  | { readonly type: "wait" }
  | { readonly type: "unavailable" };

export function matchesThreadFeedRevealTarget(
  entry: ThreadFeedEntry | { readonly type: "guest-pending"; readonly id: string },
  target: ThreadFeedRevealTarget,
): boolean {
  switch (entry.type) {
    case "message":
      return target.messageId !== null && entry.id === target.messageId;
    // Projected render ids end in the item that produced them.
    case "html-render":
      return target.turnItemId !== null && entry.id.endsWith(`:${target.turnItemId}`);
    case "mcp-app":
      return target.turnItemId !== null && entry.itemId === target.turnItemId;
    default:
      return false;
  }
}

function entryRunId(entry: ThreadFeedEntry): RunId | null {
  if (entry.type === "message") return entry.message.runId;
  return "runId" in entry ? entry.runId : null;
}

/**
 * The next move toward showing the target: scroll to it once it is a visible row, open the turn
 * fold that hides it, or page in older history while the loaded feed lacks it. Each page is
 * requested once, and the search ends at the start of history, a failed load, or the page limit.
 */
export function planThreadFeedReveal(input: {
  readonly target: ThreadFeedRevealTarget;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly presented: ReadonlyArray<
    ThreadFeedEntry | { readonly type: "guest-pending"; readonly id: string }
  >;
  readonly expandedRunIds: ReadonlySet<RunId>;
  readonly history: {
    readonly hasMoreHistory: boolean;
    readonly loading: boolean;
    readonly error: string | null;
  } | null;
  readonly requestedPages: ReadonlySet<string>;
}): ThreadFeedRevealStep {
  const { target } = input;
  if (target.messageId === null && target.turnItemId === null) return { type: "unavailable" };
  const index = input.presented.findIndex((entry) => matchesThreadFeedRevealTarget(entry, target));
  if (index >= 0) return { type: "scroll", index };
  const hidden = input.feed.find((entry) => matchesThreadFeedRevealTarget(entry, target));
  if (hidden) {
    const runId = entryRunId(hidden);
    // An open fold that still hides it means something other than the fold does.
    return runId === null || input.expandedRunIds.has(runId)
      ? { type: "unavailable" }
      : { type: "expand", runId };
  }
  const history = input.history;
  if (history === null || !history.hasMoreHistory) return { type: "unavailable" };
  const cursor = input.feed[0]?.id ?? "first";
  if (input.requestedPages.has(cursor)) {
    // The page asked for has not landed yet; a failed load ends the search.
    return history.error === null ? { type: "wait" } : { type: "unavailable" };
  }
  if (history.loading) return { type: "wait" };
  if (input.requestedPages.size >= THREAD_FEED_REVEAL_MAX_PAGES) return { type: "unavailable" };
  return { type: "load-earlier", cursor };
}
