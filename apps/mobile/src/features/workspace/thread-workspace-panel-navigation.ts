import type { WorkspacePane } from "./workspacePaneMemory";

export const closedThreadWorkspaceFileParams = {
  fileFullscreen: undefined,
  path: undefined,
  line: undefined,
  reviewSectionId: undefined,
  reviewFilePath: undefined,
  reviewWorkingTreeScope: undefined,
};

export type ThreadWorkspacePanel = "workspace" | "branches";

export function threadWorkspaceFileIsFullscreen(
  route: { readonly name: string; readonly params?: object } | undefined,
) {
  if (
    !route ||
    !["Thread", "ThreadFiles", "ThreadFile", "ThreadReview", "ThreadReviewFile"].includes(
      route.name,
    )
  )
    return false;
  const params = route.params as
    | {
        fileFullscreen?: boolean;
        workspacePanel?: ThreadWorkspacePanel;
        path?: readonly string[];
        reviewSectionId?: string;
        reviewFilePath?: string;
        reviewWorkingTreeScope?: "staged" | "unstaged";
      }
    | undefined;
  if (params?.fileFullscreen !== true || params.workspacePanel === "branches") return false;
  if (Array.isArray(params.path) && params.path.length > 0) return true;
  return Boolean(
    params.reviewSectionId && (params.reviewFilePath || params.reviewWorkingTreeScope),
  );
}

export function threadWorkspacePanelAction(
  route: { readonly name: string; readonly key: string; readonly params?: object },
  thread: { readonly environmentId: string; readonly threadId: string },
  panel: ThreadWorkspacePanel,
  pane: WorkspacePane | null,
) {
  const params = route.params as { environmentId?: string; threadId?: string } | undefined;
  if (
    ["Thread", "ThreadReview", "ThreadReviewFile", "ThreadFiles", "ThreadFile"].includes(
      route.name,
    ) &&
    params?.environmentId === thread.environmentId &&
    params?.threadId === thread.threadId
  ) {
    return {
      type: "SET_PARAMS" as const,
      payload: {
        params: { workspacePanel: panel, inspector: undefined, fileFullscreen: undefined },
      },
      source: route.key,
    };
  }
  return {
    type: "NAVIGATE" as const,
    payload: {
      name: pane === "files" ? "ThreadFiles" : "ThreadReview",
      params: { ...thread, workspacePanel: panel },
    },
  };
}
