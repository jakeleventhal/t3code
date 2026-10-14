import type { FileDiffMetadata } from "@pierre/diffs";

import { getDiffLineStat } from "~/lib/diffRendering";

import type { PullRequestReviewGuideStop } from "@t3tools/contracts";
import {
  stopFilePaths,
  reviewGuideStopProgress,
  stopSubline,
} from "@t3tools/client-runtime/review-guide-tour";

import { Badge } from "../../ui/badge";
import { ReviewChapterProgress } from "../ReviewChapterHeader";
import { ReviewChapterRail, ReviewChapterFileLink } from "../ReviewChapterRail";

/** The Guide table of contents uses the same chapter navigation as grouped Code review. */
export function GuideRail({
  stops,
  position,
  seen,
  onSelect,
  isViewed,
  onSetViewed,
  files,
  onSelectFile,
}: {
  files: ReadonlyMap<string, FileDiffMetadata>;
  onSelectFile: (path: string) => void;
  stops: ReadonlyArray<PullRequestReviewGuideStop>;
  position: number;
  seen: ReadonlySet<number>;
  onSelect: (position: number) => void;
  isViewed: (path: string) => boolean;
  onSetViewed: ((paths: ReadonlyArray<string>, viewed: boolean) => void) | null;
}) {
  return (
    <ReviewChapterRail
      ariaLabel="Review tour"
      chapters={stops.map((stop, index) => ({
        title: stop.title,
        reviewed: seen.has(index),
        ...(onSetViewed
          ? {
              review: {
                reviewedCount: reviewGuideStopProgress(stop, isViewed).reviewedCount,
                fileCount: stopFilePaths(stop).length,
                onSetReviewed: (value: boolean) => onSetViewed(stopFilePaths(stop), value),
              },
            }
          : {}),
        selectedContent:
          index === position ? (
            <div className="flex min-w-0 flex-col gap-2 px-2 pb-2">
              {onSetViewed && stopFilePaths(stop).length > 0 ? (
                <ReviewChapterProgress
                  reviewedCount={reviewGuideStopProgress(stop, isViewed).reviewedCount}
                  fileCount={stopFilePaths(stop).length}
                  onSetReviewed={(value) => onSetViewed(stopFilePaths(stop), value)}
                />
              ) : null}
              <ul className="flex min-w-0 flex-col gap-0.5">
                {stopFilePaths(stop).map((path) => {
                  const file = files.get(path);
                  const stat = file === undefined ? null : getDiffLineStat([file]);
                  return (
                    <li key={path}>
                      <ReviewChapterFileLink
                        path={path}
                        stat={stat}
                        onSelect={() => onSelectFile(path)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null,
        detail: (
          <>
            {stop.attention !== null ? (
              <Badge size="sm" variant="warning">
                Look closely
              </Badge>
            ) : null}
            <span>{stopSubline(stop)}</span>
          </>
        ),
      }))}
      position={position}
      onSelect={onSelect}
    />
  );
}
