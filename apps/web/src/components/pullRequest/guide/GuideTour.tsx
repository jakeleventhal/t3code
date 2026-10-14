import { useEnvironmentQuery } from "~/state/query";
import { useAtomValue } from "@effect/atom-react";
import { usePullRequestFilesViewed } from "../usePullRequestFilesViewed";
import type { EnvironmentId, PullRequestRef, PullRequestReviewGuide } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { createPullRequestDiffFileContentsLoader } from "~/lib/diffFileContents";
import { isEditableFocused } from "~/lib/editableFocus";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { isCommandPaletteOpen } from "~/commandPaletteBus";

import { GuideRail } from "./GuideRail";
import { GuideStop, type GuideStopHandle } from "./GuideStop";
import { DiffDisplayControls } from "../../diffs/DiffDisplayControls";
import type { ExcerptCommenting } from "./GuideExcerpt";
import {
  guideProgressKey,
  guideRunKey,
  useGuideProgress,
  useGuideRunStore,
  type GuideProgress,
} from "./guideRunStore";
import {
  stepTourPosition,
  stopFilePaths,
  reviewGuideStopProgress,
} from "@t3tools/client-runtime/review-guide-tour";
import { useGuideDiffFiles } from "./useGuideDiffFiles";

export function GuideTour({
  environmentId,
  reference,
  guide,
  banner,
  active,
  commenting,
  onAsk,
  onFinish,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  guide: PullRequestReviewGuide;
  banner: ReactNode;
  active: boolean;
  commenting: ExcerptCommenting | null;
  onAsk: ((stop: number, question: string) => void) | null;
  onFinish: (() => void) | null;
  onOpenFile: (path: string) => void;
}) {
  const key = guideProgressKey(guideRunKey(environmentId, reference), guide.headSha);
  const tour = useGuideProgress(key);
  const update = (change: (current: GuideProgress) => Partial<GuideProgress>) =>
    useGuideRunStore.getState().setProgress(key, (current) => ({ ...current, ...change(current) }));
  const [railOpen, setRailOpen] = useState(false);

  const stopCount = guide.stops.length;
  const position = Math.max(Math.min(tour.position, stopCount - 1), 0);
  const stop = guide.stops[position] ?? null;
  const detail = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  const allowed = useAtomValue(pullRequestEnvironment.setFilesViewed.permissionAtom(environmentId));
  const viewed = usePullRequestFilesViewed({
    environmentId,
    reference,
    enabled: Boolean(detail.data?.capabilities.viewedFiles),
    paths: guide.stops.flatMap(stopFilePaths),
    headSha: guide.headSha,
  });
  const reviewedStops = new Set(
    guide.stops.flatMap((stop, index) =>
      reviewGuideStopProgress(stop, viewed.isViewed).reviewed ? [index] : [],
    ),
  );

  const wantedPaths = stop === null ? [] : stopFilePaths(stop);
  const diff = useGuideDiffFiles({
    environmentId,
    reference,
    headSha: guide.headSha,
    wantedPaths,
  });
  const getDiffFileContents = useAtomCommand(pullRequestEnvironment.diffFileContents);
  const loadDiffFiles = createPullRequestDiffFileContentsLoader(getDiffFileContents, {
    environmentId,
    reference,
    commit: null,
    cacheKey: `pull-request-guide:${key}`,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const stopNavigation = useRef<GuideStopHandle>(null);
  const selectFile = (path: string) => {
    stopNavigation.current?.revealFile(path);
    setRailOpen(false);
  };
  const goTo = (next: number) => {
    update((current) => ({
      position: next,
      seen: next > position ? new Set(current.seen).add(position) : current.seen,
    }));
    setRailOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const step = (delta: 1 | -1) => goTo(stepTourPosition(position, delta, stopCount));

  const stepFromKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isCommandPaletteOpen()) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key !== "j" && event.key !== "k") return;
    if (isEditableFocused(event.target)) return;
    event.preventDefault();
    step(event.key === "j" ? 1 : -1);
  });
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => stepFromKey(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return (
    // Three widths: one column with the rail folded; the rail beside the stop; and, on a
    // maximized panel, the stop's notes in a column of their own (see GuideStop).
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 min-h-10 shrink-0 items-center justify-end gap-1 border-b border-border/60 bg-background px-4">
        <DiffDisplayControls />
      </div>
      <div
        ref={scrollRef}
        className="@container/guide min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both"
      >
        <div className="mx-auto grid max-w-[100rem] gap-6 px-4 py-4 @min-[80rem]/guide:grid-cols-[14rem_minmax(0,1fr)] @min-[90rem]/guide:gap-8 @min-[90rem]/guide:px-6">
          {/* Beside the stop on a wide panel; narrow, the stop folds the same list open under its
            header instead. */}
          <aside className="sticky top-4 self-start @max-[80rem]/guide:hidden">
            <GuideRail
              files={diff.files}
              onSelectFile={selectFile}
              stops={guide.stops}
              position={position}
              seen={reviewedStops}
              isViewed={viewed.isViewed}
              onSetViewed={
                allowed && viewed.enabled
                  ? (paths, value) => {
                      for (const path of paths) viewed.setViewed(path, value);
                    }
                  : null
              }
              onSelect={goTo}
            />
          </aside>
          <main className="flex min-w-0 flex-col gap-4">
            {banner}
            {diff.error !== null ? (
              <p className="text-xs text-muted-foreground">
                The diff could not be loaded, so excerpts are missing: {diff.error}
              </p>
            ) : null}
            {stop === null ? (
              <p className="text-sm text-muted-foreground">This change has no files to tour.</p>
            ) : (
              <GuideStop
                key={position}
                navigationRef={stopNavigation}
                stop={stop}
                isViewed={viewed.isViewed}
                onSetViewed={
                  allowed && viewed.enabled
                    ? (paths, value) => {
                        for (const path of paths) viewed.setViewed(path, value);
                      }
                    : null
                }
                index={position}
                stopCount={stopCount}
                railOpen={railOpen}
                onRailOpenChange={setRailOpen}
                stopList={
                  <GuideRail
                    files={diff.files}
                    onSelectFile={selectFile}
                    stops={guide.stops}
                    position={position}
                    seen={reviewedStops}
                    isViewed={viewed.isViewed}
                    onSetViewed={
                      allowed && viewed.enabled
                        ? (paths, value) => {
                            for (const path of paths) viewed.setViewed(path, value);
                          }
                        : null
                    }
                    onSelect={goTo}
                  />
                }
                nextTitle={guide.stops[position + 1]?.title ?? null}
                files={diff.files}
                loadDiffFiles={loadDiffFiles}
                diffLoading={diff.loading}
                commenting={commenting}
                onStep={step}
                onAsk={onAsk === null ? null : (question) => onAsk(position, question)}
                onFinish={
                  onFinish === null
                    ? null
                    : () => {
                        update((current) => ({ seen: new Set(current.seen).add(position) }));
                        onFinish();
                      }
                }
                onOpenFile={onOpenFile}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
