import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import {
  readWorkspacePane,
  rememberWorkspacePane,
  resolveWorkspacePane,
  rememberThreadWorkspaceLocation,
  readThreadReviewSelection,
  workspaceThreadMemoryKey,
  workspacePaneForLocation,
  type WorkspacePane,
} from "./workspacePaneMemory";
import { Tabs } from "../../components/ui/Tabs";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentPresentation } from "../../state/presentation";
import { vcsEnvironment } from "../../state/vcs";
import { environmentSession } from "../../state/session";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useThreadSelection } from "../../state/use-thread-selection";
import { ThreadFilesTreeScreen, ThreadFileScreen } from "../files/ThreadFilesRouteScreen";
import { PullRequestDiffStats } from "../pull-requests/PullRequestPresentation";
import { ReviewHeader, ReviewSheet } from "../review/ReviewSheet";
import { ReviewNavigatorPane } from "../review/ReviewNavigatorPane";
import {
  useAdaptiveWorkspaceLayout,
  useAdaptiveWorkspacePaneRole,
} from "../layout/AdaptiveWorkspaceLayout";
import { ThreadRouteScreen } from "../threads/ThreadRouteScreen";

import { ThreadInspectorContentStack } from "../threads/thread-inspector-content-stack";
import { GitOverviewSheet } from "../threads/git/GitOverviewSheet";
import type { ThreadWorkspacePanel } from "./thread-workspace-panel-navigation";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly path?: string[];
  readonly workspacePanel?: ThreadWorkspacePanel;
  readonly line?: string;
  readonly cwd?: string;
  readonly projectName?: string;
  readonly reviewSectionId?: string;
  readonly reviewFilePath?: string;
  readonly reviewWorkingTreeScope?: "staged" | "unstaged";
}>;

function ThreadWorkspaceScreen(props: Props & { readonly defaultPane?: WorkspacePane }) {
  useAdaptiveWorkspacePaneRole("inspector");
  const navigation = useNavigation();
  const { fileInspector, showThreadWithSidebar } = useAdaptiveWorkspaceLayout();
  const safeAreaInsets = useSafeAreaInsets();
  const paneKey = workspaceThreadMemoryKey(
    props.route.params.environmentId,
    props.route.params.threadId,
  );
  const [tab, setTab] = useState<WorkspacePane | null>(() =>
    workspacePaneForLocation(
      props.route.params,
      readWorkspacePane(paneKey) ?? props.defaultPane ?? null,
    ),
  );
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const threadId = ThreadId.make(props.route.params.threadId);
  const { selectedThreadCwd: cwd } = useSelectedThreadWorktree();
  const session = useEnvironmentQuery(environmentSession.sessionStateAtom(environmentId));
  const environment = useEnvironmentPresentation(environmentId);
  const access = resolveFilesystemReadAccess({
    isCatalogReady: environment.isReady,
    connection: environment.presentation?.connection ?? null,
    session: session.data,
    sessionError: session.error,
  });
  const status = useEnvironmentQuery(
    access.canReadFiles && cwd !== null
      ? vcsEnvironment.status({ environmentId, input: { cwd } })
      : null,
  );
  // Status counts each changed path once, including edits that cancel between
  // the index and working tree, and updates through the existing Git subscription.
  const count = status.data?.workingTree?.files.length;
  const statusUnavailable =
    !access.isPending && (!access.canReadFiles || cwd === null || status.error !== null);
  const selectedTab = resolveWorkspacePane(tab, count ?? (statusUnavailable ? 0 : undefined));
  if (selectedTab !== null && selectedTab !== tab) {
    setTab(selectedTab);
    rememberWorkspacePane(paneKey, selectedTab);
  }
  const selectTab = (pane: WorkspacePane) => {
    setTab(pane);
    rememberWorkspacePane(paneKey, pane);
    const params = props.route.params;
    if (pane === "files") {
      rememberThreadWorkspaceLocation({
        name: params.path ? "ThreadFile" : "ThreadFiles",
        params: {
          environmentId: params.environmentId,
          threadId: params.threadId,
          ...(params.path ? { path: params.path } : {}),
          ...(params.line ? { line: params.line } : {}),
          ...(params.cwd ? { cwd: params.cwd } : {}),
          ...(params.projectName ? { projectName: params.projectName } : {}),
        },
      });
    } else {
      const sectionId = params.reviewSectionId ?? readThreadReviewSelection(paneKey)?.sectionId;
      rememberThreadWorkspaceLocation({
        name:
          params.reviewFilePath || params.reviewWorkingTreeScope
            ? "ThreadReviewFile"
            : "ThreadReview",
        params: {
          environmentId: params.environmentId,
          threadId: params.threadId,
          ...(sectionId ? { reviewSectionId: sectionId } : {}),
          ...(params.reviewFilePath ? { reviewFilePath: params.reviewFilePath } : {}),
          ...(params.reviewWorkingTreeScope
            ? { reviewWorkingTreeScope: params.reviewWorkingTreeScope }
            : {}),
        },
      });
    }
  };
  const workingTree = status.data?.workingTree;
  const { selectedThread } = useThreadSelection();
  // Git actions live on the thread's Git button, and Changes has its own commit controls.
  const tabs = (
    <View className="w-full flex-row items-center bg-sheet pb-1 pl-2 pr-3">
      <Tabs
        className="min-w-0 shrink"
        options={[
          {
            value: "git" as const,
            label: "Changes",
            trailing:
              workingTree && (workingTree.insertions > 0 || workingTree.deletions > 0) ? (
                <PullRequestDiffStats
                  additions={workingTree.insertions}
                  deletions={workingTree.deletions}
                  compact
                />
              ) : undefined,
          },
          { value: "files" as const, label: "Files" },
        ]}
        selected={selectedTab ?? "files"}
        onSelect={selectTab}
      />
    </View>
  );
  const renderBranches = (headerInset: number) => (
    <GitOverviewSheet
      headerInset={headerInset}
      presentation="inspector"
      route={{ params: { environmentId, threadId } }}
    />
  );
  const renderWorkspacePanel = (headerInset: number, renderNavigator: () => ReactNode) => (
    <ThreadInspectorContentStack
      mode={props.route.params.workspacePanel === "branches" ? "git" : "route"}
      resetKeys={[paneKey, cwd]}
      renderFiles={() => null}
      renderGit={() => renderBranches(headerInset)}
      renderRoute={renderNavigator}
    />
  );
  const closeFile = () =>
    navigation.setParams({
      path: undefined,
      line: undefined,
      reviewSectionId: undefined,
      reviewFilePath: undefined,
      reviewWorkingTreeScope: undefined,
    });
  const workspaceHeader = (
    <ReviewHeader
      environmentId={environmentId}
      threadId={threadId}
      title=""
      subtitle=""
      androidSubtitle=""
      selectedThreadCwd={cwd}
      selectedSection={null}
      showBranchControl={false}
      onRefresh={async () => status.refresh()}
      onReturnToThread={fileInspector.supported ? showThreadWithSidebar : () => navigation.goBack()}
    />
  );
  if (selectedTab === null)
    return (
      <View className="flex-1 bg-sheet">
        {workspaceHeader}
        {tabs}
        <View className="flex-1 items-center justify-center">
          <AppActivityIndicator accessibilityLabel="Loading workspace" />
        </View>
      </View>
    );
  const openedReviewFile =
    props.route.params.reviewSectionId &&
    (props.route.params.reviewFilePath || props.route.params.reviewWorkingTreeScope)
      ? {
          path: props.route.params.reviewFilePath,
          sectionId: props.route.params.reviewSectionId,
          scope: props.route.params.reviewWorkingTreeScope,
        }
      : undefined;
  // With an inspector column, Changes works like Files: the navigator sits beside the chat, and
  // the diff it opens takes the content column.
  if (selectedTab === "git" && fileInspector.supported) {
    const threadParams = {
      environmentId: props.route.params.environmentId,
      threadId: props.route.params.threadId,
    };
    const renderChangesNavigator = (headerInset: number) => (
      <ReviewNavigatorPane
        environmentId={environmentId}
        threadId={threadId}
        headerInset={headerInset}
        subtitle={selectedThread?.branch ?? ""}
        toolbar={tabs}
        onSectionSelected={
          openedReviewFile
            ? () =>
                navigation.setParams({
                  reviewSectionId: undefined,
                  reviewFilePath: undefined,
                  reviewWorkingTreeScope: undefined,
                })
            : undefined
        }
      />
    );
    if (!openedReviewFile)
      return (
        <ThreadRouteScreen
          route={{ params: threadParams }}
          onReturnToThread={
            fileInspector.supported ? showThreadWithSidebar : () => navigation.goBack()
          }
          renderInspector={(headerInset) =>
            renderWorkspacePanel(headerInset, () => renderChangesNavigator(headerInset))
          }
        />
      );
    return (
      <ReviewSheet
        route={{ params: { environmentId, threadId } }}
        openedFile={openedReviewFile}
        onReturnToThread={showThreadWithSidebar}
        onCloseFile={closeFile}
        renderInspector={() =>
          renderWorkspacePanel(Platform.OS === "ios" ? 0 : safeAreaInsets.top, () =>
            renderChangesNavigator(Platform.OS === "ios" ? 0 : safeAreaInsets.top),
          )
        }
      />
    );
  }
  return selectedTab === "files" ? (
    props.route.params.path ? (
      <ThreadFileScreen
        route={{ params: { ...props.route.params, path: props.route.params.path } }}
        workspaceTabs={tabs}
        renderInspector={renderWorkspacePanel}
        onReturnToThread={showThreadWithSidebar}
        onCloseFile={closeFile}
      />
    ) : (
      <ThreadFilesTreeScreen
        route={props.route}
        workspaceTabs={tabs}
        workspaceHeader={workspaceHeader}
        renderInspector={renderWorkspacePanel}
        onReturnToThread={showThreadWithSidebar}
      />
    )
  ) : (
    <ReviewSheet
      route={{ params: { environmentId, threadId } }}
      workspaceTabs={tabs}
      workspaceHeader={props.route.params.reviewSectionId ? undefined : workspaceHeader}
      openedFile={openedReviewFile}
    />
  );
}

export function ThreadFilesWorkspaceScreen(props: Props) {
  return (
    <ThreadWorkspaceScreen
      key={`${props.route.params.environmentId}:${props.route.params.threadId}`}
      {...props}
      defaultPane="files"
    />
  );
}

export function ThreadGitWorkspaceScreen(props: Props) {
  return (
    <ThreadWorkspaceScreen
      key={`${props.route.params.environmentId}:${props.route.params.threadId}`}
      {...props}
      defaultPane="git"
    />
  );
}

export function ThreadFileWorkspaceScreen(props: Parameters<typeof ThreadFileScreen>[0]) {
  const { threadId } = props.route.params;
  if (!threadId) return <ThreadFileScreen {...props} />;
  return (
    <ThreadWorkspaceScreen
      key={`${props.route.params.environmentId}:${threadId}`}
      route={{ params: { ...props.route.params, threadId } }}
    />
  );
}
