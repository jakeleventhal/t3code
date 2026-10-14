import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { View } from "react-native";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentPresentation } from "../../state/presentation";
import { vcsEnvironment } from "../../state/vcs";
import { environmentSession } from "../../state/session";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { ThreadFilesTreeScreen, ThreadFileScreen } from "../files/ThreadFilesRouteScreen";
import { ReviewSheet } from "../review/ReviewSheet";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly path?: string[];
  readonly line?: string;
  readonly cwd?: string;
  readonly projectName?: string;
}>;

function ThreadWorkspaceScreen(props: Props & { readonly initialTab: "files" | "git" }) {
  const [tab, setTab] = useState(props.initialTab);
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
  const tabs = (
    <View className="border-b border-border-subtle bg-sheet px-3 py-2">
      <SegmentedControl
        size="compact"
        options={[
          { value: "files" as const, label: "Files" },
          { value: "git" as const, label: "Git", ...(count === undefined ? {} : { badge: count }) },
        ]}
        selected={tab}
        onSelect={setTab}
        role="tab"
      />
    </View>
  );
  return tab === "files" ? (
    props.route.params.path ? (
      <ThreadFileScreen
        route={{ params: { ...props.route.params, path: props.route.params.path } }}
        workspaceTabs={tabs}
      />
    ) : (
      <ThreadFilesTreeScreen route={props.route} workspaceTabs={tabs} />
    )
  ) : (
    <ReviewSheet route={{ params: { environmentId, threadId } }} workspaceTabs={tabs} />
  );
}

export function ThreadFilesWorkspaceScreen(props: Props) {
  return (
    <ThreadWorkspaceScreen
      key={`${props.route.params.environmentId}:${props.route.params.threadId}`}
      {...props}
      initialTab="files"
    />
  );
}

export function ThreadGitWorkspaceScreen(props: Props) {
  return (
    <ThreadWorkspaceScreen
      key={`${props.route.params.environmentId}:${props.route.params.threadId}`}
      {...props}
      initialTab="git"
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
      initialTab="files"
    />
  );
}
