import * as Clipboard from "expo-clipboard";
import { Alert, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { ControlPill } from "../../components/ControlPill";
import type { PendingReviewComment } from "./pullRequestReviewDrafts";
import type { PullRequestParams } from "./usePullRequestDiff";
import { usePendingReviewCommentActions } from "./usePendingReviewCommentActions";

export function PullRequestPendingBadge() {
  return (
    <View className="flex-row items-center gap-1 rounded-md bg-warning px-2 py-1">
      <SymbolView name="clock" size={12} tintColorClassName="accent-warning-foreground" />
      <Text className="text-2xs font-t3-medium text-warning-foreground">Pending</Text>
    </View>
  );
}

export function PullRequestPendingCommentActions({
  params,
  comment,
  onEdit,
}: {
  params: PullRequestParams;
  comment: PendingReviewComment;
  onEdit?: () => void;
}) {
  const actions = usePendingReviewCommentActions(params);
  return (
    <ControlPillMenu
      title="Comment actions"
      actions={[
        ...(onEdit
          ? [{ id: "edit", title: "Edit comment", attributes: { disabled: actions.busy } }]
          : []),
        { id: "copy", title: "Copy comment" },
        ...(comment.hostedComment || actions.canSave
          ? [{ id: "copy-link", title: "Copy link", attributes: { disabled: actions.busy } }]
          : []),
        ...(!comment.hostedComment || actions.canDiscard
          ? [
              {
                id: "discard",
                title: "Discard comment",
                attributes: { destructive: true, disabled: actions.busy },
              },
            ]
          : []),
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "edit") onEdit?.();
        else if (nativeEvent.event === "copy") void Clipboard.setStringAsync(comment.body);
        else if (nativeEvent.event === "copy-link") void actions.copyLink(comment);
        else if (nativeEvent.event === "discard")
          Alert.alert("Discard this comment?", "Your other review comments will be kept.", [
            { text: "Cancel", style: "cancel" },
            { text: "Discard", style: "destructive", onPress: () => void actions.discard(comment) },
          ]);
      }}
    >
      <ControlPill icon="ellipsis" accessibilityLabel="Comment actions" disabled={actions.busy} />
    </ControlPillMenu>
  );
}
