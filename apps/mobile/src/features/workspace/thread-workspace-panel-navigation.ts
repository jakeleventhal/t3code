import type { WorkspacePane } from "./workspacePaneMemory";

export type ThreadWorkspacePanel = "workspace" | "branches";

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
      payload: { params: { workspacePanel: panel, inspector: undefined } },
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
