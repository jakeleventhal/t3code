import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { buildThreadRouteParams } from "../threadRoutes";
import { randomUUID } from "./utils";

/** One request to reveal a message or turn item; a fresh activation repeats it. */
export interface TimelineSourceRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The timeline entry id: a message id, or the turn item id of a rendered result. */
  readonly entryId: string;
  readonly activation: string;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    timelineSource?: TimelineSourceRequest;
  }
}

/** Opens a thread at one entry. History state keeps the address clean and shareable. */
export function timelineSourceNavigation(threadRef: ScopedThreadRef, entryId: string) {
  return {
    to: "/$environmentId/$threadId" as const,
    params: buildThreadRouteParams(threadRef),
    state: {
      timelineSource: {
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        entryId,
        activation: randomUUID(),
      },
    },
  };
}
