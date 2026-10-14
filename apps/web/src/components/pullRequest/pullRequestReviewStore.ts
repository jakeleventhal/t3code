/**
 * A review being written, held until it is sent.
 *
 * Local drafts stay in this tab. Copying a comment link saves that comment in the host's
 * private pending review and retains its identity for later discard or submission. Host
 * drafts are also read back from the detail, so reloading keeps saved pending comments.
 */
import { useMemo } from "react";
import { pendingReviewCommentsFromThreads } from "@t3tools/client-runtime/review-editing";
import type {
  PullRequestRef,
  PullRequestReviewCommentDraft,
  PullRequestReviewThread,
} from "@t3tools/contracts";
import { create } from "zustand";

export type PendingReviewComment = PullRequestReviewCommentDraft & { readonly id: string };

/**
 * A counter rather than anything derived from the comment: two remarks on one line can be the
 * same length, and an id built from the draft's own contents would collide with a comment that
 * was already removed — which shares a React key with it and, worse, makes discarding one card
 * delete both.
 */
let pendingCommentSequence = 0;

export function nextPendingReviewCommentId(): string {
  pendingCommentSequence += 1;
  return `pending-review-comment-${pendingCommentSequence}`;
}

export function pullRequestReviewKey(reference: PullRequestRef): string {
  return JSON.stringify([
    reference.projectId,
    reference.host?.toLowerCase() ?? null,
    reference.repository.toLowerCase(),
    reference.number,
  ]);
}

interface PullRequestReviewStoreState {
  readonly drafts: Readonly<Record<string, ReadonlyArray<PendingReviewComment>>>;
  readonly busyComments: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly setCommentBusy: (key: string, id: string, busy: boolean) => void;
  readonly setHostedComment: (
    key: string,
    id: string,
    hosted: NonNullable<PendingReviewComment["hostedComment"]>,
  ) => void;
  readonly summaries: Readonly<Record<string, string>>;
  readonly addComment: (key: string, comment: PendingReviewComment) => void;
  readonly removeComment: (key: string, commentId: string) => void;
  readonly removeComments: (key: string, commentIds: ReadonlyArray<string>) => void;
  readonly clear: (key: string) => void;
  readonly setSummary: (key: string, body: string) => void;
  readonly clearSummary: (key: string, submittedBody: string) => void;
}

const EMPTY: ReadonlyArray<PendingReviewComment> = [];

export const usePullRequestReviewStore = create<PullRequestReviewStoreState>()((set) => ({
  drafts: {},
  busyComments: {},
  setCommentBusy: (key, id, busy) =>
    set((state) => {
      const previous = state.busyComments[key] ?? [];
      return {
        busyComments: {
          ...state.busyComments,
          [key]: busy ? [...new Set([...previous, id])] : previous.filter((entry) => entry !== id),
        },
      };
    }),
  setHostedComment: (key, id, hostedComment) =>
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: (state.drafts[key] ?? []).map((comment) =>
          comment.id === id ? { ...comment, hostedComment } : comment,
        ),
      },
    })),
  summaries: {},
  addComment: (key, comment) =>
    set((state) => ({
      drafts: { ...state.drafts, [key]: [...(state.drafts[key] ?? EMPTY), comment] },
    })),
  removeComment: (key, commentId) =>
    set((state) => {
      const remaining = (state.drafts[key] ?? EMPTY).filter((entry) => entry.id !== commentId);
      if (remaining.length > 0) return { drafts: { ...state.drafts, [key]: remaining } };
      const { [key]: _removed, ...rest } = state.drafts;
      return { drafts: rest };
    }),
  removeComments: (key, commentIds) =>
    set((state) => {
      const submitted = new Set(commentIds);
      const remaining = (state.drafts[key] ?? EMPTY).filter((entry) => !submitted.has(entry.id));
      if (remaining.length > 0) return { drafts: { ...state.drafts, [key]: remaining } };
      const { [key]: _removed, ...rest } = state.drafts;
      return { drafts: rest };
    }),
  clear: (key) =>
    set((state) => {
      const { [key]: _removed, ...rest } = state.drafts;
      return { drafts: rest };
    }),
  setSummary: (key, body) => set((state) => ({ summaries: { ...state.summaries, [key]: body } })),
  clearSummary: (key, submittedBody) =>
    set((state) => {
      // The textarea stays editable while the request is in flight. Only remove the exact draft
      // the host accepted; a revised summary for the same pull request is new work.
      if (state.summaries[key] !== submittedBody) return state;
      const { [key]: _removed, ...rest } = state.summaries;
      return { summaries: rest };
    }),
}));

export function usePendingReviewComments(
  reference: PullRequestRef,
  threads?: ReadonlyArray<PullRequestReviewThread>,
): ReadonlyArray<PendingReviewComment> {
  const local = usePullRequestReviewStore(
    (store) => store.drafts[pullRequestReviewKey(reference)] ?? EMPTY,
  );
  return useMemo(() => {
    const remote = pendingReviewCommentsFromThreads(threads ?? []);
    if (remote.length === 0) return local;
    const localHostIds = new Set(local.map((comment) => comment.hostedComment?.commentId));
    return [...local, ...remote.filter((comment) => !localHostIds.has(comment.id))];
  }, [local, threads]);
}
