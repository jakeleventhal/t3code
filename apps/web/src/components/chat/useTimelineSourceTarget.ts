import type { LegendListRef } from "@legendapp/list/react";
import type { RunId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { TimelineSourceRequest } from "../../lib/timelineSourceNavigation";
import { toastManager } from "../ui/toast";

const SOURCE_VIEW_MARGIN = 96;
const SOURCE_SETTLE_FRAME_LIMIT = 30;
// The same highlight as a revealed citation, held then faded once.
const SOURCE_HIGHLIGHT_NAME = "t3-assistant-citation";
const SOURCE_HIGHLIGHT_OPACITY = "--assistant-citation-highlight-opacity";
const SOURCE_HIGHLIGHT_PEAK = 0.45;
const SOURCE_HIGHLIGHT_HOLD_MS = 1600;
const SOURCE_HIGHLIGHT_FADE_MS = 450;
const SOURCE_HISTORY_PAGE_LIMIT = 20;

interface SourceHistory {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadEarlier: (throughEntryId?: string) => void;
}

export type TimelineSourceStep =
  | { readonly kind: "wait" }
  | { readonly kind: "load-earlier"; readonly cursor: string }
  | { readonly kind: "expand"; readonly runId: RunId }
  | { readonly kind: "reveal"; readonly index: number }
  | { readonly kind: "missing" };

/**
 * What to do next to reach one timeline entry: page older history toward it, open the turn fold
 * hiding it, or reveal its row. Each page and fold is tried once, so a source that never appears
 * ends as missing instead of looping.
 */
export function nextTimelineSourceStep(input: {
  readonly entryId: string;
  readonly entries: ReadonlyArray<{ readonly id: string }>;
  readonly rows: ReadonlyArray<{ readonly id: string }>;
  readonly history: Omit<SourceHistory, "onLoadEarlier"> | undefined;
  /** The thread is still catching up with its server, so a missing entry may yet arrive. */
  readonly syncing: boolean;
  readonly requestedCursors: ReadonlySet<string>;
  readonly expandedRunIds: ReadonlySet<RunId>;
  readonly foldRunId: RunId | undefined;
}): TimelineSourceStep {
  const index = input.rows.findIndex((row) => row.id === input.entryId);
  if (index >= 0) return { kind: "reveal", index };
  if (input.entries.some((entry) => entry.id === input.entryId)) {
    return input.foldRunId !== undefined && !input.expandedRunIds.has(input.foldRunId)
      ? { kind: "expand", runId: input.foldRunId }
      : { kind: "missing" };
  }
  const history = input.history;
  if (input.syncing || history?.loading) return { kind: "wait" };
  if (!history?.hasMoreHistory || history.error !== null) return { kind: "missing" };
  const cursor = input.entries[0]?.id ?? "first";
  return input.requestedCursors.has(cursor) ||
    input.requestedCursors.size >= SOURCE_HISTORY_PAGE_LIMIT
    ? { kind: "missing" }
    : { kind: "load-earlier", cursor };
}

function highlightRow(row: HTMLElement): () => void {
  if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) {
    return () => {};
  }
  const range = row.ownerDocument.createRange();
  range.selectNodeContents(row);
  if (range.toString().trim().length === 0) return () => {};
  const highlight = new Highlight(range);
  CSS.highlights.set(SOURCE_HIGHLIGHT_NAME, highlight);
  const total = SOURCE_HIGHLIGHT_HOLD_MS + SOURCE_HIGHLIGHT_FADE_MS;
  const animation = row.animate(
    [
      { offset: 0, [SOURCE_HIGHLIGHT_OPACITY]: SOURCE_HIGHLIGHT_PEAK },
      {
        offset: SOURCE_HIGHLIGHT_HOLD_MS / total,
        [SOURCE_HIGHLIGHT_OPACITY]: SOURCE_HIGHLIGHT_PEAK,
      },
      { offset: 1, [SOURCE_HIGHLIGHT_OPACITY]: 0 },
    ],
    { duration: total, easing: "ease-in-out" },
  );
  const clear = () => {
    if (CSS.highlights.get(SOURCE_HIGHLIGHT_NAME) === highlight) {
      CSS.highlights.delete(SOURCE_HIGHLIGHT_NAME);
    }
  };
  void animation.finished.then(clear, clear);
  return () => {
    animation.cancel();
    clear();
  };
}

/**
 * Scrolls a virtual row into view from its estimated index, then corrects against the measured
 * row until two frames agree, and highlights it. Settling is bounded, so it never keeps reading
 * layout once the row is in place.
 */
function revealTimelineRow(input: {
  list: LegendListRef;
  index: number;
  rowId: string;
  onSettled: () => void;
}) {
  const { list, rowId } = input;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stopped = false;
  let frame: number | null = null;
  let frames = 0;
  let stableFrames = 0;
  let clearHighlight = () => {};
  const finish = () => {
    if (stopped) return;
    stopped = true;
    input.onSettled();
  };
  const next = () => {
    if (!stopped) frame = requestAnimationFrame(settle);
  };
  const settle = () => {
    frame = null;
    if (stopped) return;
    frames += 1;
    const viewport = list.getScrollableNode();
    if (!(viewport instanceof HTMLElement)) return finish();
    const state = list.getState();
    const rowIndex = state.indexByKey(rowId);
    const row = rowIndex === undefined ? undefined : state.elementAtIndex(rowIndex);
    if (!row) return frames < SOURCE_SETTLE_FRAME_LIMIT ? next() : finish();
    const offset = Math.max(
      0,
      Math.min(
        viewport.scrollTop +
          row.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          SOURCE_VIEW_MARGIN,
        viewport.scrollHeight - viewport.clientHeight,
      ),
    );
    if (frames < SOURCE_SETTLE_FRAME_LIMIT) {
      if (Math.abs(viewport.scrollTop - offset) > 1) {
        stableFrames = 0;
        void list.scrollToOffset({ offset, animated: false }).then(next, finish);
        return;
      }
      stableFrames += 1;
      if (stableFrames < 2) return next();
    }
    clearHighlight = highlightRow(row);
    finish();
  };
  void Promise.resolve(
    list.scrollToIndex({
      index: input.index,
      animated: !reducedMotion,
      viewPosition: 0,
      viewOffset: SOURCE_VIEW_MARGIN,
    }),
  ).then(next, finish);
  return {
    stopSettling: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      stopped = true;
    },
    dispose: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stopped = true;
      clearHighlight();
    },
  };
}

/**
 * Reaches a requested timeline entry, such as the message a bot file was shared in, through the
 * timeline's own history paging and turn folds. `positioning` holds off end-following and
 * position restore until the row is shown, the source is missing, or the user scrolls away.
 */
export function useTimelineSourceTarget({
  request,
  entries,
  rows,
  listRef,
  listReady,
  viewport,
  historyLoading,
  historySyncing,
  history,
  getTurnFoldRunId,
  onExpandTurn,
  onManualNavigation,
}: {
  request: TimelineSourceRequest | null;
  entries: ReadonlyArray<{ readonly id: string }>;
  rows: ReadonlyArray<{ readonly id: string }>;
  listRef: RefObject<LegendListRef | null>;
  listReady: boolean;
  viewport: HTMLElement | null;
  historyLoading: boolean;
  historySyncing: boolean;
  history: SourceHistory | undefined;
  getTurnFoldRunId: (entryId: string) => RunId | undefined;
  onExpandTurn: (runId: RunId) => void;
  onManualNavigation: () => void;
}) {
  const [finishedKey, setFinishedKey] = useState<string | null>(null);
  const navigationRef = useRef<{
    key: string;
    requestedCursors: Set<string>;
    expandedRunIds: Set<RunId>;
    done: boolean;
    reveal: ReturnType<typeof revealTimelineRow> | null;
  } | null>(null);

  // oxlint-disable-next-line t3code/react-effect-budget -- Reveal a requested source only after its remote history and virtual list are ready.
  useEffect(() => {
    if (navigationRef.current?.key !== request?.activation) {
      navigationRef.current?.reveal?.dispose();
      navigationRef.current = request
        ? {
            key: request.activation,
            requestedCursors: new Set(),
            expandedRunIds: new Set(),
            done: false,
            reveal: null,
          }
        : null;
      if (request) onManualNavigation();
    }
    const navigation = navigationRef.current;
    if (!request || !navigation || navigation.done || historyLoading) return;
    const finish = () => {
      navigation.done = true;
      setFinishedKey(navigation.key);
    };
    const step = nextTimelineSourceStep({
      entryId: request.entryId,
      entries,
      rows,
      history,
      syncing: historySyncing,
      requestedCursors: navigation.requestedCursors,
      expandedRunIds: navigation.expandedRunIds,
      foldRunId: getTurnFoldRunId(request.entryId),
    });
    switch (step.kind) {
      case "wait":
        return;
      case "load-earlier":
        navigation.requestedCursors.add(step.cursor);
        history?.onLoadEarlier(request.entryId);
        return;
      case "expand":
        navigation.expandedRunIds.add(step.runId);
        onExpandTurn(step.runId);
        return;
      case "missing":
        finish();
        toastManager.add({
          type: "warning",
          title: "Couldn’t find that in the conversation",
          description: "It may have been removed. Showing the conversation instead.",
        });
        return;
      case "reveal": {
        const list = listRef.current;
        if (!listReady || !list) return;
        navigation.done = true;
        navigation.reveal = revealTimelineRow({
          list,
          index: step.index,
          rowId: request.entryId,
          onSettled: () => {
            if (navigationRef.current === navigation) setFinishedKey(navigation.key);
          },
        });
      }
    }
  }, [
    entries,
    getTurnFoldRunId,
    history,
    historyLoading,
    historySyncing,
    listReady,
    listRef,
    onExpandTurn,
    onManualNavigation,
    request,
    rows,
  ]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Dispose the virtual list reveal subscription when the timeline unmounts.
  useEffect(() => () => navigationRef.current?.reveal?.dispose(), []);

  const positioning = request !== null && finishedKey !== request.activation;

  // Scrolling away while it positions leaves the user where they scrolled to.
  // oxlint-disable-next-line t3code/react-effect-budget -- Let native scroll and keyboard input interrupt an active source reveal.
  useEffect(() => {
    if (!positioning || !viewport) return;
    const dismiss = () => {
      const navigation = navigationRef.current;
      if (!navigation) return;
      navigation.done = true;
      navigation.reveal?.stopSettling();
      setFinishedKey(navigation.key);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" ||
        (viewport.contains(event.target as Node) &&
          ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
      ) {
        dismiss();
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("touchmove", dismiss, { passive: true });
    viewport.addEventListener("pointerdown", dismiss, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchmove", dismiss);
      viewport.removeEventListener("pointerdown", dismiss);
    };
  }, [positioning, viewport]);

  return {
    positioning,
    alwaysRenderKey:
      positioning && rows.some((row) => row.id === request.entryId) ? request.entryId : null,
  };
}
