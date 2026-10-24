import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { nextTimelineSourceStep } from "./useTimelineSourceTarget";

const runId = RunId.make("run-1");
const history = { hasMoreHistory: true, loading: false, error: null };

function step(overrides: Partial<Parameters<typeof nextTimelineSourceStep>[0]> = {}) {
  return nextTimelineSourceStep({
    entryId: "message-1",
    entries: [{ id: "message-5" }, { id: "message-6" }],
    rows: [{ id: "message-5" }, { id: "message-6" }],
    history,
    syncing: false,
    requestedCursors: new Set(),
    expandedRunIds: new Set(),
    foldRunId: undefined,
    ...overrides,
  });
}

describe("nextTimelineSourceStep", () => {
  it("reveals a source that already has a row", () => {
    expect(step({ entryId: "message-6" })).toEqual({ kind: "reveal", index: 1 });
  });

  it("pages older history toward a source that isn't loaded yet, once per page", () => {
    expect(step()).toEqual({ kind: "load-earlier", cursor: "message-5" });
    expect(step({ requestedCursors: new Set(["message-5"]) })).toEqual({ kind: "missing" });
  });

  it("waits while a page loads and stops when history runs out or fails", () => {
    expect(step({ history: { ...history, loading: true } })).toEqual({ kind: "wait" });
    expect(step({ history: undefined, syncing: true })).toEqual({ kind: "wait" });
    expect(step({ history: { ...history, hasMoreHistory: false } })).toEqual({ kind: "missing" });
    expect(step({ history: undefined })).toEqual({ kind: "missing" });
    expect(step({ history: { ...history, error: "offline" } })).toEqual({ kind: "missing" });
  });

  it("opens the turn fold hiding a loaded source, and gives up if it stays hidden", () => {
    const entries = [{ id: "message-1" }, { id: "message-5" }];
    expect(step({ entries, foldRunId: runId })).toEqual({ kind: "expand", runId });
    expect(step({ entries, foldRunId: runId, expandedRunIds: new Set([runId]) })).toEqual({
      kind: "missing",
    });
    expect(step({ entries })).toEqual({ kind: "missing" });
  });

  it("bounds how far back it pages", () => {
    const requestedCursors = new Set(Array.from({ length: 20 }, (_, index) => `page-${index}`));
    expect(step({ requestedCursors })).toEqual({ kind: "missing" });
  });
});
