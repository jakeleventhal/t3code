import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";

import { NativeWorkspaceNavigatorPane } from "../layout/workspace-navigator-pane";
import { ReviewSheet } from "./ReviewSheet";

/** The Changes navigator in the inspector column; the diffs it opens fill the content column. */
export function ReviewNavigatorPane(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly headerInset: number;
  readonly subtitle: string;
  readonly toolbar: ReactNode;
  readonly embedded?: boolean;
  readonly onSectionSelected?: VoidFunction;
}) {
  const navigator = (
    <ReviewSheet
      route={{ params: { environmentId: props.environmentId, threadId: props.threadId } }}
      placement="inspector"
      workspaceTabs={Platform.OS === "ios" ? undefined : props.toolbar}
      onSectionSelected={props.onSectionSelected}
    />
  );

  if (Platform.OS === "ios" && props.embedded) return navigator;

  if (Platform.OS === "ios") {
    return (
      <NativeWorkspaceNavigatorPane
        screenId="thread-review-navigator-native"
        title="Changes"
        header={props.toolbar}
        subtitle={props.subtitle}
        insetBelowHeader
      >
        {navigator}
      </NativeWorkspaceNavigatorPane>
    );
  }

  return (
    <View className="flex-1 bg-header" style={{ paddingTop: props.headerInset }}>
      {navigator}
    </View>
  );
}
