import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { WorkspaceSectionToolbar } from "../workspace/WorkspaceSectionToolbar";

/** Bots shares Home's header with Code, so it clears Code's search; new bots start in its list. */
export function BotsToolbar() {
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <WorkspaceSectionToolbar onNewTask={startNewTask} showCompose={false} />
    </>
  );
}
