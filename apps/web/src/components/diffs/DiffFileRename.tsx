import type { FileDiffMetadata } from "@pierre/diffs";
import { resolveFileDiffPath, resolveFileDiffPreviousPath } from "~/lib/diffRendering";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { reviewRenameSegments } from "@t3tools/client-runtime/review-workspace";
import { DiffFilePathCopyButton } from "../DiffFilePathCopyButton";

function keyedRenameSegments(previous: string, path: string) {
  let prefix = "";
  return reviewRenameSegments(previous, path).map((part) => {
    prefix += part.text;
    return { ...part, key: prefix };
  });
}

/** Both complete names remain available when the diff header has truncated the rename. */
export function DiffFileRename({ file }: { file: FileDiffMetadata }) {
  const previous = resolveFileDiffPreviousPath(file);
  const path = resolveFileDiffPath(file);
  if (previous === path) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className="min-w-0 max-w-full truncate text-left text-xs" />}
        aria-label={`Renamed from ${previous} to ${path}`}
      >
        {keyedRenameSegments(previous, path).map((part) => (
          <span
            key={part.key}
            className={
              part.kind === "removed"
                ? "bg-diff-deletion/10"
                : part.kind === "added"
                  ? "bg-diff-addition/10"
                  : part.kind === "context"
                    ? "text-muted-foreground"
                    : undefined
            }
          >
            {part.text}
          </span>
        ))}
      </PopoverTrigger>
      <PopoverPopup className="w-auto max-w-xl">
        <div className="flex max-w-xl flex-col gap-1 font-mono text-xs">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 break-all">{previous}</span>
            <DiffFilePathCopyButton filePath={previous} />
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 break-all">{path}</span>
            <DiffFilePathCopyButton filePath={path} />
          </span>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
