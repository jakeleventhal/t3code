import { useNavigation, useRoute } from "@react-navigation/native";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { readWorkspacePane, workspaceThreadMemoryKey } from "./workspacePaneMemory";
import {
  threadWorkspacePanelAction,
  type ThreadWorkspacePanel,
} from "./thread-workspace-panel-navigation";

export function useThreadWorkspacePanelNavigation(environmentId: string, threadId: string | null) {
  const navigation = useNavigation();
  const route = useRoute();
  const { fileInspector, showAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  return {
    supported: fileInspector.supported && threadId !== null,
    openPanel: (panel: ThreadWorkspacePanel) => {
      if (threadId === null) return;
      showAuxiliaryPane("inspector");
      navigation.dispatch(
        threadWorkspacePanelAction(
          route,
          { environmentId, threadId },
          panel,
          readWorkspacePane(workspaceThreadMemoryKey(environmentId, threadId)),
        ),
      );
    },
  };
}
