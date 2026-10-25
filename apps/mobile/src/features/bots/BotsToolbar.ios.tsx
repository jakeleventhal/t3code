import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { WorkspaceSectionToolbar } from "../workspace/WorkspaceSectionToolbar";
import { useBotsHeaderActions } from "./bots-header";

/** Bots shares Home's header with Code, so it clears Code's search and brings its own. */
export function BotsToolbar() {
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const actions = useBotsHeaderActions();
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <Toolbar placement="right">
        <Toolbar.Button
          identifier="bots-search"
          accessibilityLabel="Search bots"
          icon="magnifyingglass"
          onPress={actions.search}
        />
        {actions.newBot ? (
          <Toolbar.Button
            identifier="bots-new"
            accessibilityLabel="New bot"
            icon="plus"
            onPress={actions.newBot}
          />
        ) : null}
      </Toolbar>
      <WorkspaceSectionToolbar onNewTask={startNewTask} showCompose={false} />
    </>
  );
}
