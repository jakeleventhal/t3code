import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { worktreeResourceThreadId } from "@t3tools/shared/worktreeResource";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "./composerDraftStore";
import { selectThreadPreviewMiniPlayer, usePreviewMiniPlayerStore } from "./previewMiniPlayerStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => {
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
});

describe("previewMiniPlayerStore", () => {
  it("keeps floating previews scoped to their thread", () => {
    usePreviewMiniPlayerStore.getState().open(refA, "tab-a");
    usePreviewMiniPlayerStore.getState().open(refB, "tab-b");

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toMatchObject({ tabId: "tab-a" });
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refB),
    ).toMatchObject({ tabId: "tab-b" });
  });

  it("preserves position when switching the floating tab within one thread", () => {
    usePreviewMiniPlayerStore.getState().open(refA, "tab-a");
    usePreviewMiniPlayerStore.getState().move(refA, "tab-a", { x: 24, y: 48 });
    usePreviewMiniPlayerStore.getState().open(refA, "tab-b");

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toEqual({
      tabId: "tab-b",
      position: { x: 24, y: 48 },
      size: null,
    });
  });

  it("ignores stale drag updates after the floating tab changes", () => {
    usePreviewMiniPlayerStore.getState().open(refA, "tab-a");
    usePreviewMiniPlayerStore.getState().open(refA, "tab-b");
    usePreviewMiniPlayerStore.getState().move(refA, "tab-a", { x: 100, y: 100 });

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toEqual({
      tabId: "tab-b",
      position: null,
      size: null,
    });
  });

  it("shares one entry between a worktree's canonical ref and a sibling thread ref", () => {
    const environmentId = "env-1" as EnvironmentId;
    const projectId = ProjectId.make("project-1");
    const worktreePath = "/repo/worktree";
    const siblingThreadId = ThreadId.make("thread-A");
    const siblingRef = scopeThreadRef(environmentId, siblingThreadId);
    const canonicalRef = scopeThreadRef(
      environmentId,
      worktreeResourceThreadId(projectId, worktreePath),
    );

    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), DraftId.make("draft-1"), {
        threadId: siblingThreadId,
        worktreePath,
      });

    // Automation opens the player through the worktree's canonical thread ref
    // while ChatView selects it with whichever sibling thread is being viewed.
    usePreviewMiniPlayerStore.getState().open(canonicalRef, "tab-a");

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, siblingRef),
    ).toMatchObject({ tabId: "tab-a" });

    usePreviewMiniPlayerStore.getState().close(siblingRef);
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, canonicalRef),
    ).toBeNull();
  });

  it("preserves a thread-bound size while switching tabs", () => {
    usePreviewMiniPlayerStore.getState().open(refA, "tab-a");
    usePreviewMiniPlayerStore.getState().resize(refA, "tab-a", { width: 480, height: 320 });
    usePreviewMiniPlayerStore.getState().open(refA, "tab-b");

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toMatchObject({ tabId: "tab-b", size: { width: 480, height: 320 } });
  });
});
