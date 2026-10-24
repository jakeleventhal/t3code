import { useCallback } from "react";
import { Keyboard } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { workspaceTabRoom, type WorkspaceTab } from "./workspace-tabs-state";

/** Opens a workspace tab, Settings included, from a tab bar, rail, toolbar or command. */
export function useSelectWorkspaceTab() {
  const dispatch = useWorkspaceTabs()?.dispatch;
  const { openWorkspaceTab } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs();
  return useCallback(
    (tab: WorkspaceTab | "settings") => {
      Keyboard.dismiss();
      if (tab !== "settings" && workspace && workspaceTabRoom(tab) !== workspace.state.room)
        return workspace.selectTab(tab);
      openWorkspaceTab(tab);
      if (tab !== "settings") dispatch?.({ type: "select", tab });
    },
    [dispatch, openWorkspaceTab, workspace],
  );
}
