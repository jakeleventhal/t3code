import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useAdaptiveWorkspaceLayout } from "./AdaptiveWorkspaceLayout";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { withNativeGlassHeaderItem } from "./native-glass-header-items";

export function useWorkspaceSidebarHeaderItem() {
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const pullRequests = useWorkspaceTabs()?.state.selectedTab === "pullRequests";
  const sidebarName = pullRequests ? "pull requests sidebar" : "thread sidebar";
  const { layout, panes, togglePrimarySidebar, primarySidebarDrawerVisible } =
    useAdaptiveWorkspaceLayout();
  const label = primarySidebarDrawerVisible
    ? `Hide ${sidebarName}`
    : panes.primarySidebarVisible
      ? layout.primarySidebarOverlaysContent
        ? `Hide ${sidebarName}`
        : "Maximize content"
      : `Show ${sidebarName}`;
  return withNativeGlassHeaderItem({
    axisBehavior: usesNativeWorkspaceColumns ? "horizontalOnly" : undefined,
    accessibilityLabel: label,
    icon: {
      name:
        panes.primarySidebarVisible && !layout.primarySidebarOverlaysContent
          ? "arrow.up.left.and.arrow.down.right"
          : "sidebar.left",
      type: "sfSymbol" as const,
    },
    identifier: "thread-left-sidebar",
    label,
    onPress: togglePrimarySidebar,
    type: "button" as const,
  });
}
