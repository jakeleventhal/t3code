import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PullRequestReviewThread } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ControlPill } from "../../components/ControlPill";
import { composerPullRequests } from "../../state/pull-requests";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { PullRequestCommentControls } from "./PullRequestCommentControls";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestAvatar } from "./PullRequestPresentation";
import {
  PullRequestPendingBadge,
  PullRequestPendingCommentActions,
} from "./PullRequestPendingComment";
import { usePullRequestReviewDraft } from "./usePullRequestReviewDraft";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { relativeTime } from "../../lib/time";

function CommentThread({
  params,
  thread,
  onOpen,
}: {
  params: PullRequestParams;
  thread: PullRequestReviewThread;
  onOpen: () => void;
}) {
  const target = pullRequestTarget(params);
  const detail = useEnvironmentQuery(composerPullRequests.detail(target));
  const permissions = usePullRequestPermissions(params, detail.data);
  const resolve = useAtomCommand(composerPullRequests.setThreadResolution, {
    reportFailure: false,
  });
  const first = thread.comments[0];
  if (!first) return null;
  const toggle = async () => {
    const result = await resolve({
      ...target,
      input: { ...target.input, threadId: thread.id, resolved: !thread.isResolved },
    });
    if (result._tag === "Failure") Alert.alert("Could not update the thread", "Try again.");
  };
  const canResolve = permissions.canResolve && thread.canResolve !== false;
  return (
    <View className="overflow-hidden rounded-2xl border border-border-subtle bg-grouped-card">
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open discussion in ${thread.path}`}
        className="border-b border-border-subtle px-3 py-2"
      >
        <Text className="font-mono text-2xs text-foreground-muted" numberOfLines={2}>
          {thread.path}
          {thread.line ? `:${thread.line}` : ""}
        </Text>
      </Pressable>
      <PullRequestCommentControls
        params={params}
        comment={{ ...first, url: first.url ?? null }}
        onResolve={canResolve && !thread.isResolved ? () => void toggle() : undefined}
        onUnresolve={canResolve && thread.isResolved ? () => void toggle() : undefined}
        render={({ actions, reactions }) => (
          <View className="gap-2 p-3">
            <View className="flex-row items-center gap-2">
              <PullRequestAvatar actor={first.author} size={24} />
              <Text className="min-w-0 flex-1 text-xs font-t3-medium" numberOfLines={1}>
                {first.author?.login ?? "Unknown author"}
              </Text>
              <Text className="text-2xs text-foreground-muted">
                {relativeTime(first.createdAt)}
              </Text>
              {actions}
            </View>
            {thread.isResolved ? (
              <Text className="text-xs text-foreground-muted">
                Resolved · {thread.commentCount ?? thread.comments.length} comments
              </Text>
            ) : (
              <PullRequestMarkdown markdown={first.body} />
            )}
            {reactions}
            <Pressable accessibilityRole="button" onPress={onOpen} className="py-2">
              <Text className="text-xs text-foreground-muted">
                {thread.isResolved
                  ? "Expand discussion"
                  : `${Math.max(0, (thread.commentCount ?? thread.comments.length) - 1)} replies · Open discussion`}
              </Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

/** One PR-wide checklist remains accessible while switching review tabs. */
export function PullRequestCommentsSheet({
  params,
  visible,
  onClose,
}: {
  params: PullRequestParams;
  visible: boolean;
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const draft = usePullRequestReviewDraft(params);
  const [status, setStatus] = useState<"resolved" | "unresolved" | "pending">("unresolved");
  const resolved = draft.threads.filter((thread) => thread.isResolved);
  const unresolved = draft.threads.filter((thread) => !thread.isResolved);
  // Removing the last draft also removes its tab; stay on an available status.
  const selectedStatus =
    status === "pending" && draft.comments.length === 0 ? "unresolved" : status;
  if (selectedStatus !== status) setStatus(selectedStatus);
  const threads =
    selectedStatus === "resolved" ? resolved : selectedStatus === "unresolved" ? unresolved : [];
  const pending = selectedStatus === "pending" ? draft.comments : [];
  const options = [
    { value: "unresolved" as const, label: "Unresolved", badge: unresolved.length },
    { value: "resolved" as const, label: "Resolved", badge: resolved.length },
    ...(draft.comments.length
      ? [{ value: "pending" as const, label: "Pending", badge: draft.comments.length }]
      : []),
  ];
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-screen">
        <View className="flex-row items-center gap-3 border-b border-border-subtle px-4 py-3">
          <Text className="flex-1 text-lg font-t3-semibold">Comments</Text>
          <ControlPill icon="xmark" accessibilityLabel="Close comments" onPress={onClose} />
        </View>
        <View className="px-4 pt-3">
          <SegmentedControl
            options={options}
            selected={selectedStatus}
            onSelect={setStatus}
            variant="tabs"
            size="compact"
          />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {pending.map((comment) => (
            <View
              key={comment.id}
              className="gap-2 rounded-2xl border border-border-subtle bg-grouped-card p-3"
            >
              <View className="flex-row items-center gap-2">
                <PullRequestPendingBadge />
                <View className="flex-1" />
                <PullRequestPendingCommentActions params={params} comment={comment} />
              </View>
              <Text className="font-mono text-2xs text-foreground-muted" numberOfLines={2}>
                {comment.path}
              </Text>
              <PullRequestMarkdown markdown={comment.body} />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  navigation.navigate("PullRequestInlineComment", {
                    ...params,
                    draftId: comment.id,
                    path: comment.path,
                    position: comment.position,
                    headSha: comment.headSha,
                    code: comment.code,
                    ...(comment.oldPath ? { oldPath: comment.oldPath } : {}),
                  });
                }}
              >
                <Text className="py-2 text-xs text-foreground-muted">Open pending comment</Text>
              </Pressable>
            </View>
          ))}
          {threads.map((thread) => (
            <CommentThread
              key={thread.id}
              params={params}
              thread={thread}
              onOpen={() => {
                onClose();
                navigation.navigate("PullRequestDiscussion", {
                  ...params,
                  discussionId: thread.id,
                });
              }}
            />
          ))}
          {!threads.length && !pending.length ? (
            <Text className="text-sm text-foreground-muted">
              {selectedStatus === "resolved" ? "No resolved comments." : "No unresolved comments."}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
