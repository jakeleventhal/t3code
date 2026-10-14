import { resolvedReviewCommentsLabel } from "@t3tools/client-runtime/review-editing";
import { reviewLineRangeLabel } from "@t3tools/client-runtime/review-selection";
import { PullRequestCommentComposer } from "./PullRequestCommentComposer";
import { PullRequestCommentControls } from "./PullRequestCommentControls";
import { useAtomRefresh } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import type { PullRequestThreadComment } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { NativeScrollViewMarker as ScrollViewMarker } from "../../native/NativeScrollViewMarker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { MaterialButton } from "../../components/MaterialButton";
import { ControlPill } from "../../components/ControlPill";
import { SymbolView } from "../../components/AppSymbol";
import { PullRequestPendingBadge } from "./PullRequestPendingComment";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { relativeTime } from "../../lib/time";
import { composerPullRequests } from "../../state/pull-requests";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { PullRequestMarkdown, PullRequestMarkdownRepository } from "./PullRequestMarkdown";
import { PullRequestAvatar } from "./PullRequestPresentation";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { pullRequestReviewKey } from "./pullRequestReviewDrafts";

export function PullRequestDiscussionScreen({
  route,
}: StaticScreenProps<PullRequestParams & { readonly discussionId: string }>) {
  return (
    <Discussion
      key={`${pullRequestReviewKey(route.params)}:${route.params.discussionId}`}
      params={route.params}
    />
  );
}

function Discussion({ params }: { params: PullRequestParams & { readonly discussionId: string } }) {
  const target = pullRequestTarget(params);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const bottomInset = keyboardVisible ? 8 : Math.max(insets.bottom, 12);
  const activity = useEnvironmentQuery(composerPullRequests.activity(target));
  const detail = useEnvironmentQuery(composerPullRequests.detail(target));
  const permissions = usePullRequestPermissions(params, detail.data);
  const refresh = useAtomRefresh(composerPullRequests.activity(target));
  const reply = useAtomCommand(composerPullRequests.replyToThread, { reportFailure: false });
  const resolve = useAtomCommand(composerPullRequests.setThreadResolution, {
    reportFailure: false,
  });
  const loadMore = useAtomCommand(composerPullRequests.threadComments, { reportFailure: false });
  const thread = activity.data?.reviewThreads.find((thread) => thread.id === params.discussionId);
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState("");
  const resolved = thread?.isResolved ?? false;
  const [lastResolved, setLastResolved] = useState(resolved);
  const [expanded, setExpanded] = useState(!resolved);
  if (lastResolved !== resolved) {
    setLastResolved(resolved);
    setExpanded(!resolved);
  }
  const [extra, setExtra] = useState<readonly PullRequestThreadComment[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = async (run: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await run();
    pending.current = false;
    setBusy(false);
    if (result && AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "The provider could not complete this action.",
      );
    }
  };
  const post = () =>
    operation(async () => {
      if (uploading || !permissions.canReply || !body.trim() || !thread) return;
      const submitted = body;
      const response = await reply({
        ...target,
        input: { ...target.input, threadId: thread.id, body: submitted },
      });
      if (AsyncResult.isFailure(response)) return response;
      setBody((current) => (current === submitted ? "" : current));
      setNotice("Reply posted.");
      refresh();
      return response;
    });
  const toggleResolved = async () => {
    if (
      !thread ||
      !permissions.canResolve ||
      thread.canResolve === false ||
      thread.comments.some((comment) => comment.pendingReviewId)
    )
      return;
    setError(null);
    setNotice(null);
    const response = await resolve({
      ...target,
      input: { ...target.input, threadId: thread.id, resolved: !thread.isResolved },
    });
    if (response._tag === "Failure") {
      const cause = squashAtomCommandFailure(response);
      setError(
        cause instanceof Error ? cause.message : "The provider could not update this discussion.",
      );
    }
  };
  const nextCursor = cursor === undefined ? thread?.nextCommentsCursor : cursor;
  const more = () =>
    operation(async () => {
      if (!thread || !nextCursor) return undefined;
      const response = await loadMore({
        ...target,
        input: { ...target.input, threadId: thread.id, cursor: nextCursor },
      });
      if (AsyncResult.isFailure(response)) return response;
      setExtra((comments) => [...comments, ...response.value.comments]);
      setCursor(response.value.nextCursor);
      return response;
    });
  const comments = [
    ...new Map(
      [...extra, ...(thread?.comments ?? [])].map((comment) => [comment.id, comment]),
    ).values(),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const canReply =
    permissions.canReply &&
    Boolean(thread) &&
    expanded &&
    !thread?.comments.some((comment) => comment.pendingReviewId);
  const canResolve =
    permissions.canResolve &&
    thread?.canResolve !== false &&
    !thread?.comments.some((comment) => comment.pendingReviewId);
  const participants = comments.map(
    (comment) => comment.author?.name ?? comment.author?.login ?? "Unknown author",
  );
  return (
    <PullRequestMarkdownRepository
      params={params}
      value={detail.data?.provider === "github" ? detail.data.url : null}
    >
      <KeyboardAvoidingView automaticOffset behavior="height" className="flex-1 bg-screen">
        <NativeStackScreenOptions
          options={{ title: "Discussion", unstable_headerSubtitle: `#${params.number}` }}
        />
        {Platform.OS === "android" ? (
          <AndroidScreenHeader
            title="Discussion"
            subtitle={`#${params.number}`}
            onBack={() => navigation.goBack()}
          />
        ) : null}
        <ScrollViewMarker style={{ flex: 1 }}>
          <ScrollView
            className="flex-1"
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 20,
              paddingBottom: 24,
            }}
          >
            {activity.isPending && !thread ? <AppActivityIndicator /> : null}
            {thread ? (
              <View className="gap-2 pb-4">
                <Text selectable className="font-mono text-xs text-foreground-muted">
                  {thread.path}
                  {` · ${reviewLineRangeLabel(thread)}`}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {thread.isResolved ? "Resolved" : "Unresolved"}
                  {thread.isOutdated ? " · Outdated" : ""}
                </Text>
                <Button
                  label="View file diff"
                  onPress={() =>
                    navigation.navigate("PullRequestFile", { ...params, path: thread.path })
                  }
                />
              </View>
            ) : !activity.isPending ? (
              <Text>This discussion is no longer available.</Text>
            ) : null}
            {resolved ? (
              <View className="flex-row items-center gap-2 rounded-xl border border-border-subtle bg-grouped-card px-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  className="min-h-12 min-w-0 flex-1 flex-row items-center gap-2"
                  onPress={() => setExpanded(!expanded)}
                >
                  <SymbolView
                    name="checkmark.circle"
                    size={16}
                    tintColorClassName="accent-icon-muted"
                  />
                  <Text className="min-w-0 flex-1 text-sm text-foreground-muted">
                    {expanded
                      ? "Collapse"
                      : resolvedReviewCommentsLabel(
                          thread?.commentCount ?? comments.length,
                          participants,
                        )}
                  </Text>
                  <SymbolView
                    name={expanded ? "chevron.up" : "chevron.down"}
                    size={12}
                    tintColorClassName="accent-icon-muted"
                  />
                </Pressable>
                {!expanded && comments[0] ? (
                  <PullRequestCommentControls
                    params={params}
                    comment={{ ...comments[0], url: comments[0].url ?? null }}
                    onUnresolve={canResolve ? () => void toggleResolved() : undefined}
                    disabled={busy}
                    render={({ actions }) => actions}
                  />
                ) : null}
              </View>
            ) : null}
            {expanded
              ? comments.map((comment, index) => (
                  <View key={comment.id} className="gap-3 border-b border-border-subtle py-4">
                    <PullRequestCommentControls
                      params={params}
                      comment={{ ...comment, url: comment.url ?? null }}
                      onUnresolve={resolved && canResolve ? () => void toggleResolved() : undefined}
                      onResolve={
                        !resolved && canResolve && index === 0
                          ? () => void toggleResolved()
                          : undefined
                      }
                      disabled={busy}
                      render={({ actions, reactions }) => (
                        <>
                          <View className="flex-row items-center gap-2">
                            <PullRequestAvatar actor={comment.author} size={28} />
                            <Text
                              className="min-w-0 flex-1 text-sm font-t3-medium"
                              numberOfLines={1}
                            >
                              {comment.author?.name ?? comment.author?.login ?? "Unknown author"}
                            </Text>
                            <Text className="text-2xs text-foreground-muted">
                              {relativeTime(comment.createdAt)}
                            </Text>
                            {comment.pendingReviewId ? <PullRequestPendingBadge /> : null}
                            {index === 0 && !resolved && canResolve ? (
                              <ControlPill
                                icon="checkmark"
                                accessibilityLabel="Resolve thread"
                                disabled={busy}
                                onPress={() => void toggleResolved()}
                              />
                            ) : null}
                            {actions}
                          </View>
                          <PullRequestMarkdown markdown={comment.body} />
                          {reactions}
                        </>
                      )}
                    />
                  </View>
                ))
              : null}
            {expanded && nextCursor ? (
              <MaterialButton
                label={busy ? "Loading…" : "Load more replies"}
                disabled={busy}
                onPress={() => void more()}
              />
            ) : null}
            {error || activity.error ? (
              <Text selectable className="py-4 text-sm text-danger-foreground">
                {error ?? activity.error}
              </Text>
            ) : null}
            {notice ? <Text className="py-4 text-sm text-foreground-muted">{notice}</Text> : null}
          </ScrollView>
        </ScrollViewMarker>
        {canReply ? (
          <View className="px-4" style={{ paddingBottom: bottomInset }}>
            <PullRequestCommentComposer
              params={params}
              label="Discussion reply"
              placeholder="Leave a reply…"
              value={body}
              onChangeText={setBody}
              editable={!busy}
              busy={busy}
              canSubmit={!busy && !uploading && Boolean(body.trim())}
              submitLabel={busy ? "Posting…" : "Send reply"}
              onSubmit={() => void post()}
              onBusyChange={setUploading}
              minimumHeight={56}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </PullRequestMarkdownRepository>
  );
}
