import type { PullRequestReviewGuideStop } from "@t3tools/contracts";
import { stopSubline } from "@t3tools/client-runtime/review-guide-tour";

import { Badge } from "../../ui/badge";
import { ReviewChapterRail } from "../ReviewChapterRail";

/** The Guide table of contents uses the same chapter navigation as grouped Code review. */
export function GuideRail({
  stops,
  position,
  seen,
  onSelect,
}: {
  stops: ReadonlyArray<PullRequestReviewGuideStop>;
  position: number;
  seen: ReadonlySet<number>;
  onSelect: (position: number) => void;
}) {
  return (
    <ReviewChapterRail
      ariaLabel="Review tour"
      chapters={stops.map((stop, index) => ({
        title: stop.title,
        reviewed: seen.has(index),
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
