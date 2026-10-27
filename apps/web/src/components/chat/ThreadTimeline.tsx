import type { ScopedThreadRef } from "@t3tools/contracts";
import { type ComponentProps, useLayoutEffect } from "react";
import { useIncrementalTimelineEntries } from "../../hooks/useIncrementalTimelineEntries";
import type { TimelineEntriesInput, TimelineEntry } from "../../session-logic";
import { useThreadVisibleTurnItems } from "../../state/entities";
import {
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
} from "../ChatView.logic";
import { MessagesTimeline } from "./MessagesTimeline";
import { workEntryDisplayLabel } from "./MessagesTimeline.logic";

/**
 * The timeline with the streamed text. ChatView reads the thread through its quiet
 * atoms, which hold through text deltas; this reads the live turn items, so a
 * delta re-renders the timeline without re-rendering ChatView.
 */
export function ThreadTimeline({
  threadDetailRef,
  entriesInput,
  draftEntries,
  activeThreadKey,
  syncing,
  detailLoading,
  simpleProgress = false,
  ...timelineProps
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries"> & {
  /** Null until the thread's detail may load; see resolveThreadDetailRef. */
  threadDetailRef: ScopedThreadRef | null;
  entriesInput: Omit<TimelineEntriesInput, "visibleTurnItems">;
  /** A local draft's optimistic rows; null for a server thread. */
  draftEntries: ReadonlyArray<TimelineEntry> | null;
  activeThreadKey: string | null;
  syncing: boolean;
  detailLoading: boolean;
  simpleProgress?: boolean;
}) {
  const visibleTurnItems = useThreadVisibleTurnItems(threadDetailRef);
  const serverEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...entriesInput,
    visibleTurnItems,
  });
  const entries = draftEntries ?? serverEntries;
  // Bot chats hide the work log, so the one tool running now becomes a single line instead.
  const liveTool = simpleProgress
    ? entries.findLast(
        (entry) =>
          entry.kind === "work" &&
          entry.entry.tone === "tool" &&
          entry.entry.toolLifecycleStatus === "inProgress",
      )
    : undefined;
  const simpleActivity =
    liveTool?.kind === "work"
      ? workEntryDisplayLabel(liveTool.entry, timelineProps.workspaceRoot ?? undefined)
      : null;
  const displayedEntries = resolveThreadSwitchTimeline({
    loading: entries.length === 0 && syncing,
    activeThreadKey,
    nextEntries: entries,
    rememberedForActive: peekRememberedThreadTimeline<typeof entries>(activeThreadKey),
  });
  useLayoutEffect(() => {
    if (detailLoading || entries.length === 0 || timelineHasEphemeralPreviewUrls(entries)) {
      return;
    }
    rememberReadyThreadTimeline({ threadKey: activeThreadKey, entries });
  }, [activeThreadKey, detailLoading, entries]);
  return (
    <MessagesTimeline
      {...timelineProps}
      simpleProgress={simpleProgress}
      simpleActivity={simpleActivity}
      timelineEntries={
        simpleProgress
          ? displayedEntries.filter(
              (entry) =>
                entry.kind !== "work" ||
                (entry.entry.tone !== "tool" && entry.entry.tone !== "thinking") ||
                entry.entry.toolLifecycleStatus === "failed",
            )
          : displayedEntries
      }
    />
  );
}
