import {
  FILL_PREVIEW_VIEWPORT,
  type PreviewAutomationOpenInput,
  type PreviewResizeInput,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type ScopedThreadRef,
} from "@t3tools/contracts";

export const DEFAULT_PREVIEW_AUTOMATION_VIEWPORT = {
  _tag: "freeform",
  width: 1280,
  height: 800,
} as const satisfies PreviewViewportSetting;

export function shouldOpenPreviewMiniPlayer(input: PreviewAutomationOpenInput): boolean {
  return input.open ?? input.show ?? true;
}

export function previewAutomationOpenNeedsOverlay(
  input: PreviewAutomationOpenInput,
  snapshot: PreviewSessionSnapshot,
): boolean {
  return input.url !== undefined || snapshot.navStatus._tag !== "Idle";
}

export function previewAutomationDefaultViewport(
  reusedExistingTab: boolean,
  snapshot: PreviewSessionSnapshot,
): PreviewViewportSetting | null {
  const viewport = snapshot.viewport ?? FILL_PREVIEW_VIEWPORT;
  return !reusedExistingTab && viewport._tag === "fill"
    ? DEFAULT_PREVIEW_AUTOMATION_VIEWPORT
    : null;
}

export function previewAutomationOpenResizeTarget(
  threadRef: ScopedThreadRef,
  tabId: string,
  viewport: PreviewViewportSetting,
): {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly input: PreviewResizeInput;
} {
  return {
    environmentId: threadRef.environmentId,
    input: {
      threadId: threadRef.threadId,
      tabId,
      viewport,
    },
  };
}
