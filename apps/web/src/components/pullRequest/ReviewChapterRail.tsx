import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/** Shared table of contents for generated Guide chapters and file-type Code chapters. */
export function ReviewChapterRail({
  chapters,
  position,
  onSelect,
  ariaLabel,
}: {
  chapters: ReadonlyArray<{ title: string; detail: ReactNode; reviewed: boolean }>;
  position: number;
  onSelect: (position: number) => void;
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="flex min-h-0 flex-col gap-4">
      <p className="text-xs text-muted-foreground tabular-nums @max-[56rem]/guide:hidden">
        {chapters.filter((chapter) => chapter.reviewed).length} of {chapters.length} chapters
        reviewed
      </p>
      <ol className="flex flex-col gap-0.5">
        {chapters.map((chapter, index) => (
          <li key={index}>
            <button
              type="button"
              aria-current={position === index ? "step" : undefined}
              onClick={() => onSelect(index)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                position === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-2xs tabular-nums",
                  chapter.reviewed
                    ? "border-success/40 text-success-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {chapter.reviewed ? (
                  <CheckIcon aria-label={`Chapter ${index + 1}, reviewed`} className="size-3" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm text-foreground">{chapter.title}</span>
                {chapter.detail !== null ? (
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {chapter.detail}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
