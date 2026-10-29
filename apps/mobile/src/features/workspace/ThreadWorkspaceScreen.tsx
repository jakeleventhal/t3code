import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Activity, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
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
  WorkspacePaneOwnerContext,
} from "../layout/AdaptiveWorkspaceLayout";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";
import type { ThreadInspectorTarget } from "../threads/thread-inspector-navigation";
import { ThreadRouteScreen } from "../threads/ThreadRouteScreen";

import { ThreadInspectorContentStack } from "../threads/thread-inspector-content-stack";
import { GitOverviewSheet } from "../threads/git/GitOverviewSheet";
import {
  closedThreadWorkspaceFileParams,
  type ThreadWorkspacePanel,
} from "./thread-workspace-panel-navigation";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly path?: string[];
  readonly workspacePanel?: ThreadWorkspacePanel;
  readonly inspector?: ThreadInspectorTarget;
  readonly prompt?: string | string[];
  readonly line?: string;
  readonly cwd?: string;
  readonly projectName?: string;
  readonly reviewSectionId?: string;
  readonly reviewFilePath?: string;
  readonly reviewWorkingTreeScope?: "staged" | "unstaged";
}>;

function ThreadWorkspaceScreen(
  props: Props & { readonly defaultPane?: WorkspacePane; readonly threadEntry?: boolean },
) {
  useAdaptiveWorkspacePaneRole("inspector");
  const navigation = useNavigation();
  const { fileInspector, pinPrimarySidebar } = useAdaptiveWorkspaceLayout();
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
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  // Git actions live on the thread's Git button, and Changes has its own commit controls.
  const tabs = (
    <View className="flex-row items-center">
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
  const renderWorkspacePanel = (
    headerInset: number,
    renderNavigator: () => ReactNode,
    renderFiles: () => ReactNode = () => null,
  ) => (
    <ThreadInspectorContentStack
      mode={
        props.route.params.workspacePanel === "branches"
          ? "git"
          : selectedTab === "files"
            ? "files"
            : "route"
      }
      resetKeys={[paneKey, cwd]}
      renderFiles={renderFiles}
      renderGit={() => renderBranches(headerInset)}
      renderRoute={renderNavigator}
    />
  );
  const closeFile = () => navigation.setParams(closedThreadWorkspaceFileParams);
  const returnToThread = () => {
    closeFile();
    pinPrimarySidebar();
  };
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
      onReturnToThread={fileInspector.supported ? returnToThread : () => navigation.goBack()}
    />
  );
  if (selectedTab === null && !fileInspector.supported && !props.threadEntry)
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
  if (fileInspector.supported || props.threadEntry) {
    const renderFiles = (headerInset: number, alternativeContent?: ReactNode) => {
      if (cwd !== null)
        return (
          <ThreadFileNavigatorPane
            active={selectedTab === "files" && props.route.params.workspacePanel !== "branches"}
            cwd={cwd}
            environmentId={environmentId}
            headerInset={headerInset}
            projectName={selectedThreadProject?.title ?? "Files"}
            selectedPath={props.route.params.path?.join("/") ?? null}
            toolbar={tabs}
            alternativeContent={alternativeContent}
            onSelectFile={(path) =>
              navigation.setParams({ path: path.split("/"), line: undefined })
            }
          />
        );
      return (
        <View className="flex-1 items-center justify-center">
          <AppActivityIndicator accessibilityLabel="Loading workspace" />
        </View>
      );
    };
    const renderChanges = (headerInset: number, embedded = false) => (
      <ReviewNavigatorPane
        environmentId={environmentId}
        threadId={threadId}
        headerInset={headerInset}
        subtitle={selectedThread?.branch ?? ""}
        toolbar={tabs}
        embedded={embedded}
        onSectionSelected={openedReviewFile ? closeFile : undefined}
      />
    );
    const renderInspector = (headerInset: number) => {
      // Keep the selected-tab glass attached to one UIKit header while its pane changes.
      if (Platform.OS === "ios" && cwd !== null)
        return (
          <ThreadInspectorContentStack
            mode={props.route.params.workspacePanel === "branches" ? "git" : "route"}
            resetKeys={[paneKey, cwd]}
            renderFiles={() => null}
            renderGit={() => renderBranches(headerInset)}
            renderRoute={() => renderFiles(headerInset, renderChanges(headerInset, true))}
          />
        );
      return renderWorkspacePanel(
        headerInset,
        () => renderChanges(headerInset),
        () => renderFiles(headerInset),
      );
    };
    const showFile = selectedTab === "files" && props.route.params.path !== undefined;
    const showDiff = selectedTab === "git" && openedReviewFile !== undefined;
    const showThread = !showFile && !showDiff;
    return (
      <View className="flex-1 bg-sheet">
        <View
          style={[StyleSheet.absoluteFill, { opacity: showThread ? 1 : 0 }]}
          pointerEvents={showThread ? "auto" : "none"}
          accessibilityElementsHidden={!showThread}
          importantForAccessibility={showThread ? "auto" : "no-hide-descendants"}
        >
          <ThreadRouteScreen
            active={showThread}
            route={{ params: props.route.params }}
            onReturnToThread={returnToThread}
            renderInspector={renderInspector}
          />
        </View>
        <WorkspacePaneOwnerContext value={false}>
          <Activity mode={showFile ? "visible" : "hidden"}>
            {props.route.params.path ? (
              <ThreadFileScreen
                route={{ params: { ...props.route.params, path: props.route.params.path } }}
                workspaceTabs={tabs}
                renderInspector={(headerInset) => renderInspector(headerInset)}
                onReturnToThread={returnToThread}
                onCloseFile={closeFile}
              />
            ) : null}
          </Activity>
          <Activity mode={showDiff ? "visible" : "hidden"}>
            {openedReviewFile ? (
              <ReviewSheet
                route={{ params: { environmentId, threadId } }}
                openedFile={openedReviewFile}
                onReturnToThread={returnToThread}
                onCloseFile={closeFile}
                renderInspector={() =>
                  renderInspector(Platform.OS === "ios" ? 0 : safeAreaInsets.top)
                }
              />
            ) : null}
          </Activity>
        </WorkspacePaneOwnerContext>
      </View>
    );
  }
  return selectedTab === "files" ? (
    props.route.params.path ? (
      <ThreadFileScreen
        route={{ params: { ...props.route.params, path: props.route.params.path } }}
        workspaceTabs={tabs}
        renderInspector={renderWorkspacePanel}
        onReturnToThread={returnToThread}
        onCloseFile={closeFile}
      />
    ) : (
      <ThreadFilesTreeScreen
        route={props.route}
        workspaceTabs={tabs}
        workspaceHeader={workspaceHeader}
        renderInspector={renderWorkspacePanel}
        onReturnToThread={returnToThread}
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

export function ThreadWorkspaceRouteScreen(props: Parameters<typeof ThreadRouteScreen>[0]) {
  const nativeColumns = useNativeWorkspaceColumnsSupported();
  const params = props.route.params;
  if (!nativeColumns || !params?.environmentId || !params.threadId || params.draft) {
    return <ThreadRouteScreen {...props} />;
  }
  return (
    <ThreadWorkspaceScreen
      key={`${params.environmentId}:${params.threadId}`}
      threadEntry
      route={{
        params: { ...params, environmentId: params.environmentId, threadId: params.threadId },
      }}
    />
  );
}
