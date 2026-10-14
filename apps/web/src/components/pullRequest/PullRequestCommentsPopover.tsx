import type {
  EnvironmentId,
  PullRequestDetailView,
  PullRequestRef,
  PullRequestReviewThread,
  PullRequestThreadComment,
} from "@t3tools/contracts";
import { FileCode2Icon, MessageSquareIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { reviewLineRangeLabel } from "@t3tools/client-runtime/review-selection";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger, PopoverTitle } from "../ui/popover";
import {
  getReviewPositionAnchor,
  PendingReviewCommentCard,
  ReviewThreadCard,
} from "./PullRequestReviewAnnotation";
import { usePendingReviewComments, type PendingReviewComment } from "./pullRequestReviewStore";
import { useReviewThreadActions } from "./useReviewThreadActions";

type CommentLocation = {
  readonly path: string;
  readonly line: number | null;
  readonly side: "left" | "right";
  readonly threadId?: string;
};

/** A PR-wide conversation checklist that stays reachable across all three review tabs. */
export function PullRequestCommentsPopover({
  environmentId,
  reference,
  detail,
  onRefresh,
  onOpenComment,
  onAddThreadCommentToComposer,
  onAddPendingToComposer,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  onRefresh: () => void;
  onOpenComment: (location: CommentLocation) => void;
  onAddThreadCommentToComposer?:
    | ((thread: PullRequestReviewThread, comment: PullRequestThreadComment) => void)
    | undefined;
  onAddPendingToComposer?: ((comment: PendingReviewComment) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const pending = usePendingReviewComments(reference, detail.reviewThreads);
  const actions = useReviewThreadActions(environmentId, reference, detail, onRefresh);
  // Hosted drafts are represented by the merged pending list, so they get one checklist entry.
  const threads = detail.reviewThreads.flatMap((thread) => {
    const comments = thread.comments.filter((comment) => !comment.pendingReviewId);
    return comments.length ? [{ ...thread, comments }] : [];
  });
  const unresolved = threads.filter((thread) => !thread.isResolved);
  const resolved = threads.filter((thread) => thread.isResolved);
  const openCount = unresolved.length + pending.length;
  const jump = (location: CommentLocation) => {
    setOpen(false);
    onOpenComment(location);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button size="xs" variant="ghost-muted" />}
        aria-label={`Comments, ${openCount} open`}
      >
        <MessageSquareIcon className="size-3.5" />
        Comments
        <Badge variant="secondary" size="sm">
          {openCount}
        </Badge>
      </PopoverTrigger>
      <PopoverPopup align="end" padding="none" width="auto">
        <div className="flex max-h-[min(75vh,48rem)] w-[min(32rem,calc(100vw-2rem))] flex-col">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <PopoverTitle>Comments</PopoverTitle>
            <span className="text-xs text-muted-foreground">
              {unresolved.length} unresolved · {pending.length} pending
            </span>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              className="ml-auto"
              aria-label="Close comments"
              onClick={() => setOpen(false)}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto py-2">
            {open ? (
              <>
                {[...unresolved, ...(showResolved ? resolved : [])].map((thread) => (
                  <div key={thread.id}>
                    <div className="mx-3 mt-2">
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        onClick={() =>
                          jump({
                            path: thread.path,
                            line: thread.line,
                            side: thread.side,
                            threadId: thread.id,
                          })
                        }
                      >
                        <FileCode2Icon className="size-3.5 shrink-0" />
                        <span className="truncate">{thread.path}</span>
                        {thread.line !== null ? (
                          <span className="shrink-0">{reviewLineRangeLabel(thread)}</span>
                        ) : null}
                      </Button>
                    </div>
                    <ReviewThreadCard
                      {...actions(thread)}
                      thread={thread}
                      workspaceRoot={detail.workspaceRoot}
                      canReact={detail.capabilities.reactions === true}
                      environmentId={environmentId}
                      reference={reference}
                      onReacted={onRefresh}
                      onAddToComposer={
                        onAddThreadCommentToComposer
                          ? (comment) => onAddThreadCommentToComposer(thread, comment)
                          : undefined
                      }
                    />
                  </div>
                ))}
                {pending.map((comment) => (
                  <div key={comment.id}>
                    <div className="mx-3 mt-2">
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        onClick={() =>
                          jump({
                            path: comment.path,
                            ...getReviewPositionAnchor(comment.position),
                          })
                        }
                      >
                        <FileCode2Icon className="size-3.5 shrink-0" />
                        <span className="truncate">{comment.path}</span>
                      </Button>
                    </div>
                    <PendingReviewCommentCard
                      comment={comment}
                      environmentId={environmentId}
                      reference={reference}
                      canCopyLink={
                        detail.capabilities.review.draftComment === true &&
                        detail.viewerPermissions.comment
                      }
                      onAddToComposer={
                        onAddPendingToComposer ? () => onAddPendingToComposer(comment) : undefined
                      }
                    />
                  </div>
                ))}
                {openCount === 0 && (!showResolved || resolved.length === 0) ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">No open comments.</p>
                ) : null}
              </>
            ) : null}
          </div>
          {resolved.length ? (
            <div className="border-t border-border/60 px-3 py-2">
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={() => setShowResolved((previous) => !previous)}
              >
                {showResolved ? "Hide" : "Show"} {resolved.length} resolved{" "}
                {resolved.length === 1 ? "thread" : "threads"}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
