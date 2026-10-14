import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";
import {
  pullRequestReviewKey,
  usePullRequestReviewStore,
  type PendingReviewComment,
} from "./pullRequestReviewStore";

/** Saving a link stays private; discarding and submitting still operate on that same comment. */
export function usePendingReviewCommentActions(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
) {
  const key = pullRequestReviewKey(reference);
  const canSave = useAtomValue(
    pullRequestEnvironment.saveDraftComment.permissionAtom(environmentId),
  );
  const canDiscard = useAtomValue(
    pullRequestEnvironment.discardDraftComment.permissionAtom(environmentId),
  );
  const busy = usePullRequestReviewStore((store) => (store.busyComments[key]?.length ?? 0) > 0);
  const save = useAtomCommand(pullRequestEnvironment.saveDraftComment, { reportFailure: false });
  const remove = useAtomCommand(pullRequestEnvironment.discardDraftComment, {
    reportFailure: false,
  });
  const copyLink = async (givenComment: PendingReviewComment) => {
    const store = usePullRequestReviewStore.getState();
    const comment =
      store.drafts[key]?.find((entry) => entry.id === givenComment.id) ?? givenComment;
    if (comment.hostedComment) return comment.hostedComment.url;
    if (store.busyComments[key]?.includes(comment.id)) return null;
    store.setCommentBusy(key, comment.id, true);
    try {
      const result = await save({ environmentId, input: { ...reference, comment } });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not save the pending comment link" });
        return null;
      }
      store.setHostedComment(key, comment.id, result.value);
      return result.value.url;
    } finally {
      store.setCommentBusy(key, comment.id, false);
    }
  };
  const discard = async (givenComment: PendingReviewComment) => {
    const store = usePullRequestReviewStore.getState();
    const comment =
      store.drafts[key]?.find((entry) => entry.id === givenComment.id) ?? givenComment;
    if (store.busyComments[key]?.includes(comment.id)) return false;
    store.setCommentBusy(key, comment.id, true);
    try {
      if (comment.hostedComment) {
        const result = await remove({
          environmentId,
          input: { ...reference, ...comment.hostedComment },
        });
        if (result._tag === "Failure") {
          toastManager.add({ type: "error", title: "Could not discard the pending comment" });
          return false;
        }
      }
      store.removeComment(key, comment.id);
      return true;
    } finally {
      store.setCommentBusy(key, comment.id, false);
    }
  };
  const discardAll = async (comments: ReadonlyArray<PendingReviewComment>) => {
    for (const comment of comments) {
      if (!(await discard(comment))) return;
    }
  };
  return { busy, canSave, canDiscard, copyLink, discard, discardAll };
}
