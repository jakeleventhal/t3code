import { useNavigation, useRoute } from "@react-navigation/native";
import type { AppBarAction } from "../../components/ui/AppBar.types";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { threadWorkspaceFileIsFullscreen } from "./thread-workspace-panel-navigation";

export function useSelectedFileHeaderActions(
  onCloseFile: VoidFunction | undefined,
): readonly AppBarAction[] {
  const navigation = useNavigation();
  const route = useRoute();
  const { fileInspector, layout } = useAdaptiveWorkspaceLayout();
  const nativeWorkspace = useNativeWorkspaceColumnsSupported();
  const fullscreen = threadWorkspaceFileIsFullscreen(route);
  if (!onCloseFile) return [];
  return [
    {
      accessibilityLabel: "Close file",
      axisBehavior: "horizontalOnly",
      icon: "xmark",
      onPress: onCloseFile,
    },
    ...((nativeWorkspace && fileInspector.supported && layout.usesSplitView) || fullscreen
      ? [
          {
            accessibilityLabel: fullscreen ? "Show file tree" : "Expand file",
            axisBehavior: "horizontalOnly" as const,
            icon: fullscreen
              ? ("sidebar.right" as const)
              : ("arrow.up.left.and.arrow.down.right" as const),
            onPress: () => navigation.setParams({ fileFullscreen: fullscreen ? undefined : true }),
          },
        ]
      : []),
  ];
}
