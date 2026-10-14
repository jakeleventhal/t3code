import * as Hash from "effect/Hash";
import { useAtomValue } from "@effect/atom-react";
import {
  orderReviewFiles,
  reviewPatchHunks,
  reviewHunkPatch,
  reviewFolderContains,
} from "@t3tools/client-runtime/review-workspace";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { MaterialButton } from "../../components/MaterialButton";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { reviewEnvironment } from "../../state/review";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  resolveNativeReviewDiffView,
  type NativeReviewDiffViewHandle,
} from "../diffs/nativeReviewDiffSurface";
import { NATIVE_REVIEW_DIFF_CONTENT_WIDTH } from "./nativeReviewDiffAdapter";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useReviewDiffData } from "./useReviewDiffData";
import { useNativeReviewDiffBridge } from "./useNativeReviewDiffBridge";
import { useReviewCommentSelectionController } from "./useReviewCommentSelectionController";
import { buildReviewParsedDiff, type ReviewSectionItem } from "./reviewModel";
import {
  applyWorkingChangesTreeMutation,
  type WorkingChangesTreeState,
} from "./workingChangesTreeState";
import { WorkingChangesTree, type WorkingScope } from "./WorkingChangesTree";
import { useWorkingChangesQuery } from "./useWorkingChangesQuery";
import {
  getWorkingChangesReviewMemory,
  rememberWorkingChangesAnchor,
  updateWorkingChangesReviewMemory,
} from "./workingChangesReviewMemory";

type Props = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  cwd: string;
  draftMessage: string;
  revision?: string;
  onChanged: () => void;
  openedFile?: { readonly scope: WorkingScope; readonly path?: string } | undefined;
  onOpenScope: (scope: WorkingScope) => void;
  onOpenFile: (file: { readonly scope: WorkingScope; readonly path: string }) => void;
};

function useWorkingChanges(props: Props, scope: WorkingScope | undefined, generation: number) {
  const query = useWorkingChangesQuery({
    environmentId: props.environmentId,
    cwd: props.cwd,
    scope,
    revision: props.revision,
    generation,
  });
  const source = query.data?.sources.find((source) => source.kind === "working-tree");
  const section = useMemo<ReviewSectionItem>(
    () => ({
      id: `working-tree:${scope ?? "all"}`,
      kind: "working-tree",
      title:
        scope === "staged"
          ? "Staged files"
          : scope === "unstaged"
            ? "Unstaged files"
            : "All changed files",
      subtitle: null,
      diff: source?.diff ?? null,
      source,
      isLoading: query.isPending && query.data === null,
    }),
    [scope, source, query.isPending, query.data],
  );
  const diff = useReviewDiffData({
    environmentId: props.environmentId,
    cwd: props.cwd,
    threadKey: `${props.environmentId}:${props.threadId}`,
    selectedSection: section,
    revision: source?.diffHash,
    draftMessage: props.draftMessage,
    workingTreeScope: scope,
  });
  const files = useMemo(
    () =>
      orderReviewFiles(
        diff.parsedDiff.kind === "files" ? diff.parsedDiff.files : [],
        (file) => file.path,
      ),
    [diff.parsedDiff],
  );
  const hunks = useMemo(() => {
    const result = new Map<string, ReadonlyArray<string>>();
    for (const patch of [...(source ? [source.diff] : []), ...diff.rawPatches]) {
      for (const entry of reviewPatchHunks(patch)) {
        const parsed = buildReviewParsedDiff(
          entry.filePatch,
          `${scope}:${Hash.string(entry.filePatch)}`,
        );
        if (parsed.kind === "files")
          for (const file of parsed.files) result.set(file.path, entry.hunks);
      }
    }
    return result;
  }, [scope, source, diff.rawPatches]);
  return { query, source, section, diff, files, hunks };
}

/** The Git overview owns staging; selecting a file opens its scoped diff. */
export function WorkingChangesReview(props: Props) {
  const memoryKey = JSON.stringify([props.environmentId, props.threadId, props.cwd]);
  return <WorkingChangesReader key={memoryKey} {...props} memoryKey={memoryKey} />;
}

function WorkingChangesReader(props: Props & { readonly memoryKey: string }) {
  const { environmentId, threadId, cwd } = props;
  const [remembered] = useState(() => getWorkingChangesReviewMemory(props.memoryKey));
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState(
    props.openedFile?.path
      ? { scope: props.openedFile.scope, path: props.openedFile.path }
      : remembered.selection,
  );
  const [visibleFileId, setVisibleFileId] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(remembered.foldedPaths));
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState(remembered.message);
  useEffect(() => {
    updateWorkingChangesReviewMemory(props.memoryKey, {
      selection,
      foldedPaths: [...folded],
      message,
    });
  }, [props.memoryKey, selection, folded, message]);
  const [generating, setGenerating] = useState(false);
  const staged = useWorkingChanges(props, "staged", generation);
  const unstaged = useWorkingChanges(props, "unstaged", generation);
  const scopes = { staged, unstaged };
  const [optimisticTree, setOptimisticTree] = useState<
    | (WorkingChangesTreeState & {
        confirmed: boolean;
        stagedBefore: typeof staged.query.data;
        unstagedBefore: typeof unstaged.query.data;
      })
    | null
  >(null);
  const queryData = useRef({ staged: staged.query.data, unstaged: unstaged.query.data });
  useLayoutEffect(() => {
    queryData.current = { staged: staged.query.data, unstaged: unstaged.query.data };
  }, [staged.query.data, unstaged.query.data]);
  const tree = optimisticTree ?? { staged: staged.files, unstaged: unstaged.files };
  const [pullRefreshing, setPullRefreshing] = useState(false);
  useEffect(() => {
    if (staged.query.isPending || unstaged.query.isPending) return;
    // eslint-disable-next-line react/set-state-in-effect -- The remote query completion ends a user-triggered refresh.
    setPullRefreshing(false);
    if (!optimisticTree?.confirmed) return;
    if (
      (staged.query.data !== optimisticTree.stagedBefore &&
        unstaged.query.data !== optimisticTree.unstagedBefore) ||
      staged.query.error ||
      unstaged.query.error
    ) {
      setOptimisticTree(null);
      busy.current = false;
      setPending(false);
    }
  }, [
    optimisticTree,
    staged.query.data,
    unstaged.query.data,
    staged.query.isPending,
    unstaged.query.isPending,
    staged.query.error,
    unstaged.query.error,
  ]);
  const selected =
    selection && scopes[selection.scope].files.some((file) => file.path === selection.path)
      ? selection
      : selection &&
          scopes[selection.scope === "staged" ? "unstaged" : "staged"].files.some(
            (file) => file.path === selection.path,
          )
        ? {
            ...selection,
            scope: selection.scope === "staged" ? ("unstaged" as const) : ("staged" as const),
          }
        : null;
  const scope =
    props.openedFile && !props.openedFile.path
      ? props.openedFile.scope
      : (selected?.scope ?? (unstaged.files.length ? "unstaged" : "staged"));
  const data = scopes[scope];
  const selectedPath =
    props.openedFile && !props.openedFile.path
      ? null
      : (selected?.path ?? props.openedFile?.path ?? null);
  const readerKey = JSON.stringify(["git", scope, selectedPath]);
  const restoreAnchor = useMemo(
    () => getWorkingChangesReviewMemory(props.memoryKey).anchors[readerKey],
    [props.memoryKey, readerKey],
  );
  const files = useMemo(
    () =>
      props.openedFile && !props.openedFile.path
        ? data.files
        : data.files.filter((file) => file.path === selectedPath),
    [data.files, selectedPath, props.openedFile],
  );
  const canStage = useAtomValue(reviewEnvironment.setStaged.permissionAtom(environmentId));
  const rendered = useMemo(() => {
    const native = data.diff.nativeReviewDiffData;
    const paths = new Set(files.map((file) => file.path));
    const nativeFiles = native.files.filter((file) => paths.has(file.path));
    const ids = new Set(nativeFiles.map((file) => file.id));
    const filesById = new Map(files.map((file) => [file.id, file]));
    return {
      ...native,
      files: nativeFiles,
      rows: native.rows
        .filter((row) => row.fileId && ids.has(row.fileId))
        .map((row) => {
          if (row.kind !== "hunk") return row;
          const file = filesById.get(row.fileId ?? "");
          const patch = file && reviewHunkPatch(data.hunks.get(file.path) ?? [], row.text ?? "");
          if (!patch) return row;
          return {
            ...row,
            // A tap from an older native frame must not act on a replaced patch or scope.
            id: `${row.id}:${scope}:${Hash.string(patch)}`,
            hunkAction: scope === "staged" ? ("Unstage hunk" as const) : ("Stage hunk" as const),
            hunkActionDisabled: !canStage || pending,
          };
        }),
    };
  }, [data.diff.nativeReviewDiffData, data.hunks, files, scope, canStage, pending]);
  const file = files.find((file) => file.id === visibleFileId) ?? files[0];
  const canRevert = useAtomValue(reviewEnvironment.revert.permissionAtom(environmentId));
  const canCommit = useAtomValue(reviewEnvironment.commit.permissionAtom(environmentId));
  const canGenerate = useAtomValue(
    reviewEnvironment.generateCommitMessage.permissionAtom(environmentId),
  );
  const stage = useAtomCommand(reviewEnvironment.setStaged, { reportFailure: false });
  const revert = useAtomCommand(reviewEnvironment.revert, { reportFailure: false });
  const commit = useAtomCommand(reviewEnvironment.commit, { reportFailure: false });
  const generateMessage = useAtomCommand(reviewEnvironment.generateCommitMessage, {
    reportFailure: false,
  });
  const refresh = () => {
    setGeneration((current) => current + 1);
    props.onChanged();
  };
  const lock = () => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    return true;
  };
  const unlock = () => {
    busy.current = false;
    setPending(false);
  };
  const pathsFor = (scope: WorkingScope, path: string | null) =>
    scopes[scope].files.flatMap((file) =>
      path === null || file.path === path || reviewFolderContains(path, file.path)
        ? [file.path, ...(file.previousPath ? [file.previousPath] : [])]
        : [],
    );
  const optimisticallyUpdateTree = (
    scope: WorkingScope,
    paths: ReadonlyArray<string>,
    revert = false,
  ) => {
    setOptimisticTree({
      ...applyWorkingChangesTreeMutation(tree, { scope, paths, revert }),
      confirmed: false,
      stagedBefore: staged.query.data,
      unstagedBefore: unstaged.query.data,
    });
  };
  const settleTreeMutation = (success: boolean) => {
    if (success)
      setOptimisticTree((current) =>
        current
          ? {
              ...current,
              confirmed: true,
              stagedBefore: queryData.current.staged,
              unstagedBefore: queryData.current.unstaged,
            }
          : null,
      );
    else {
      setOptimisticTree(null);
      unlock();
    }
    refresh();
  };
  const updateStaging = async (
    scope: WorkingScope,
    paths: ReadonlyArray<string>,
    patch?: string,
  ) => {
    if (!canStage || !paths.length || !lock()) return;
    if (!patch) optimisticallyUpdateTree(scope, paths);
    const result = await stage({
      environmentId,
      input: {
        cwd,
        paths: [...new Set(paths)],
        staged: scope === "unstaged",
        ...(patch ? { patch } : {}),
      },
    });
    if (patch) {
      unlock();
      refresh();
    } else settleTreeMutation(result._tag === "Success");
    if (result._tag === "Failure")
      Alert.alert("Could not update staging", "The file may have changed. Refresh and try again.");
    else if (!patch)
      setSelection((current) => ({
        scope: scope === "unstaged" ? "staged" : "unstaged",
        path: current && paths.includes(current.path) ? current.path : paths[0]!,
      }));
  };
  const confirmRevert = (path: string | null) => {
    const paths = pathsFor("unstaged", path);
    if (!canRevert || pending || !paths.length) return;
    Alert.alert(
      path ? `Revert ${path}?` : "Revert all unstaged changes?",
      "Unstaged changes will be discarded and selected untracked files deleted. Staged changes are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revert",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!lock()) return;
              optimisticallyUpdateTree("unstaged", paths, true);
              const result = await revert({ environmentId, input: { cwd, paths } });
              settleTreeMutation(result._tag === "Success");
              if (result._tag === "Failure")
                Alert.alert("Could not revert changes", "Refresh and try again.");
            })();
          },
        },
      ],
    );
  };
  const generatePreview = async () => {
    if (!canGenerate || !staged.files.length || !lock()) return;
    Keyboard.dismiss();
    setGenerating(true);
    const result = await generateMessage({ environmentId, input: { cwd } });
    unlock();
    setGenerating(false);
    if (result._tag === "Success") setMessage(result.value);
    else
      Alert.alert(
        "Could not generate a commit message",
        "Check your source-control writing model in Settings and try again.",
      );
  };
  const runCommit = async (action: "commit" | "amend" | "commit-push") => {
    if (!canCommit || (!staged.files.length && (action !== "amend" || !message.trim())) || !lock())
      return;
    Keyboard.dismiss();
    const result = await commit({ environmentId, input: { cwd, message, action } });
    unlock();
    refresh();
    if (result._tag === "Failure")
      Alert.alert(
        "Could not commit",
        "Check your staged changes and Git or source-control writer settings, then try again.",
      );
    else {
      setMessage("");
      Alert.alert(
        result.value.pushStatus === "failed"
          ? "Committed, but push failed"
          : result.value.pushStatus === "pushed"
            ? "Committed and pushed"
            : "Committed",
        result.value.pushStatus === "failed"
          ? "Your commit is saved locally. Check the remote connection and retry pushing from the Git menu."
          : result.value.commitSha.slice(0, 7),
      );
    }
  };
  const commentSelection = useReviewCommentSelectionController({
    environmentId,
    threadId,
    selectedSection: data.section,
    nativeReviewDiffData: rendered,
  });
  const foldedFileIds = useMemo(
    () => new Set(rendered.files.filter((file) => folded.has(file.path)).map((file) => file.id)),
    [rendered.files, folded],
  );
  const filesById = useMemo(
    () => new Map(rendered.files.map((file) => [file.id, file])),
    [rendered.files],
  );
  const bridge = useNativeReviewDiffBridge({
    threadKey: `${environmentId}:${threadId}`,
    sectionId: data.section.id,
    diff: data.source?.diff,
    data: rendered,
    collapsedFileIds: [...foldedFileIds],
    viewedFileIds: [],
    selectedRowIds: commentSelection.selectedRowIds,
    canHighlight: props.openedFile !== undefined,
  });
  const { nativeReviewDiffStyle } = useAppearanceCodeSurface();
  const { themeAppearance } = useAppearancePreferences();
  const loadingChanges = [staged, unstaged].some(
    ({ query }) => query.isPending && query.data === null,
  );
  const nativeView = useRef<NativeReviewDiffViewHandle>(null);
  const [NativeDiffView] = useState(() => resolveNativeReviewDiffView());
  const loadFile = data.diff.loadVisibleFile;
  useEffect(() => {
    if (selectedPath) loadFile(selectedPath);
    if (restoreAnchor) loadFile(restoreAnchor.path);
  }, [selectedPath, loadFile, restoreAnchor]);
  const visibleRows = useMemo(
    () =>
      Platform.OS === "android"
        ? rendered.rows.filter((row) => row.kind === "file" || !foldedFileIds.has(row.fileId ?? ""))
        : rendered.rows,
    [rendered.rows, foldedFileIds],
  );
  const offsetsInFile = useMemo(() => {
    const offsets = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const row of visibleRows) {
      const id = row.fileId ?? "";
      const index = counts.get(id) ?? 0;
      offsets.set(row.id, index);
      counts.set(id, index + 1);
    }
    return offsets;
  }, [visibleRows]);
  const restoreIndex = useMemo(() => {
    if (!restoreAnchor) return -1;
    const file = rendered.files.find((file) => file.path === restoreAnchor.path);
    if (!file) return -1;
    const fileRows = visibleRows.filter((row) => row.fileId === file.id);
    const anchor =
      restoreAnchor.kind === "line"
        ? fileRows.find(
            (row) =>
              row.kind === "line" &&
              row.oldLineNumber === restoreAnchor.oldLineNumber &&
              row.newLineNumber === restoreAnchor.newLineNumber,
          )
        : fileRows[restoreAnchor.offsetInFile];
    return visibleRows.indexOf(anchor ?? fileRows[0]!);
  }, [restoreAnchor, rendered.files, visibleRows]);
  const restoreState = useRef({
    readerKey,
    ready: restoreAnchor === undefined,
    jumped: Platform.OS === "android",
    firstRowIndex: -1,
    waitForPath: null as string | null,
  });
  const restoreRequired = restoreAnchor !== undefined;
  useLayoutEffect(() => {
    if (restoreState.current.readerKey !== readerKey)
      restoreState.current = {
        readerKey,
        ready: !restoreRequired,
        jumped: Platform.OS === "android",
        firstRowIndex: -1,
        waitForPath: null,
      };
  }, [readerKey, restoreRequired]);
  const [completedRestoreKey, setCompletedRestoreKey] = useState<string | null>(null);
  const [initialIndex, setInitialIndex] = useState({ readerKey, index: restoreIndex });
  if (
    initialIndex.readerKey !== readerKey ||
    (completedRestoreKey !== readerKey && initialIndex.index !== restoreIndex)
  )
    setInitialIndex({ readerKey, index: restoreIndex });
  const selectFile = (scope: WorkingScope, path: string) => {
    setSelection({ scope, path });
    const target = scopes[scope];
    const id = target.files.find((file) => file.path === path)?.id ?? path;
    rememberWorkingChangesAnchor(props.memoryKey, JSON.stringify(["git", scope, path]), {
      path,
      kind: "file",
      offsetInFile: 0,
    });
    setVisibleFileId(id);
    target.diff.loadVisibleFile(path);
    setFolded((current) => new Set([...current].filter((foldedPath) => foldedPath !== path)));
    commentSelection.clearSelection();
    props.onOpenFile({ scope, path });
  };
  if (!props.openedFile) {
    const error = staged.query.error ?? unstaged.query.error;
    const hasChanges =
      tree.staged.length > 0 || tree.unstaged.length > 0 || optimisticTree !== null;
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {error ? <Text className="px-4 py-3 text-xs text-danger-foreground">{error}</Text> : null}
        {hasChanges ? (
          <>
            <View className="gap-2 px-3 py-2">
              <View className="min-h-11 flex-row items-center rounded-xl border border-border-subtle bg-card">
                <TextInput
                  accessibilityLabel="Commit message"
                  value={message}
                  onChangeText={setMessage}
                  editable={!pending}
                  multiline
                  placeholder="Message (blank generates one)"
                  textAlignVertical="top"
                  className="min-h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 py-2 text-sm"
                  style={{ maxHeight: 144 }}
                />
                {tree.staged.length ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Generate commit message"
                    accessibilityState={{ disabled: !canGenerate || pending }}
                    disabled={!canGenerate || pending}
                    onPress={() => void generatePreview()}
                    className="size-11 items-center justify-center"
                  >
                    <SymbolView name="sparkles" size={21} tintColorClassName="accent-icon" />
                  </Pressable>
                ) : null}
              </View>
              <View className="min-h-11 flex-row overflow-hidden rounded-xl bg-primary">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Commit"
                  accessibilityState={{
                    disabled: !canCommit || pending || !staged.files.length,
                  }}
                  disabled={!canCommit || pending || !staged.files.length}
                  onPress={() => void runCommit("commit")}
                  className="min-h-11 flex-1 flex-row items-center justify-center gap-2 active:opacity-70"
                >
                  <SymbolView
                    name="checkmark"
                    size={18}
                    tintColorClassName="accent-primary-foreground"
                  />
                  <Text className="font-t3-medium text-primary-foreground">
                    {generating ? "Generating…" : "Commit"}
                  </Text>
                </Pressable>
                <ControlPillMenu
                  title="Commit options"
                  actions={[
                    {
                      id: "commit",
                      title: "Commit",
                      attributes: { disabled: !canCommit || pending || !staged.files.length },
                    },
                    {
                      id: "amend",
                      title: "Commit (Amend)",
                      attributes: {
                        disabled:
                          !canCommit || pending || (!staged.files.length && !message.trim()),
                      },
                    },
                    {
                      id: "commit-push",
                      title: "Commit & Push",
                      attributes: { disabled: !canCommit || pending || !staged.files.length },
                    },
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (
                      nativeEvent.event === "commit" ||
                      nativeEvent.event === "amend" ||
                      nativeEvent.event === "commit-push"
                    )
                      void runCommit(nativeEvent.event);
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Commit options"
                    className="size-11 items-center justify-center border-l border-primary-foreground/30"
                  >
                    <SymbolView
                      name="chevron.down"
                      size={16}
                      tintColorClassName="accent-primary-foreground"
                    />
                  </Pressable>
                </ControlPillMenu>
              </View>
            </View>
            <WorkingChangesTree
              staged={tree.staged}
              unstaged={tree.unstaged}
              selected={selected}
              disabled={!canStage || pending}
              revertDisabled={!canRevert || pending}
              onSelect={selectFile}
              onStage={(scope, path) => void updateStaging(scope, pathsFor(scope, path))}
              onRevert={confirmRevert}
              onOpenScope={props.onOpenScope}
              onRefresh={() => {
                setPullRefreshing(true);
                refresh();
              }}
              refreshing={pullRefreshing}
            />
          </>
        ) : (
          <ScrollView
            alwaysBounceVertical
            refreshControl={
              <RefreshControl
                refreshing={pullRefreshing}
                onRefresh={() => {
                  setPullRefreshing(true);
                  refresh();
                }}
              />
            }
          >
            <Text className="px-4 py-3 text-xs text-foreground-muted">
              {loadingChanges
                ? "Loading changes…"
                : error
                  ? "Changes are unavailable."
                  : "No uncommitted changes."}
            </Text>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    );
  }
  const label = scope === "staged" ? "Unstage" : "Stage";
  return (
    <View className="flex-1">
      <View className="min-h-11 flex-row items-center gap-2 border-b border-border-subtle py-2 pl-4 pr-2">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground-muted">
          {data.section.title}
        </Text>
        {file ? (
          <MaterialButton
            label={`${label} file`}
            tone="primary"
            disabled={!canStage || pending}
            onPress={() => void updateStaging(scope, pathsFor(scope, file.path))}
          />
        ) : null}
      </View>
      {commentSelection.selectionAction ? (
        <View className="flex-row items-center gap-2 px-4 py-2">
          <Text className="flex-1 text-xs">{commentSelection.selectionAction.title}</Text>
          {commentSelection.selectionAction.onOpenComment ? (
            <MaterialButton
              label="Add to composer"
              tone="contrast"
              onPress={commentSelection.selectionAction.onOpenComment}
            />
          ) : null}
          <MaterialButton label="Clear" onPress={commentSelection.clearSelection} />
        </View>
      ) : null}
      {data.query.error ? (
        <Text className="px-4 text-xs text-danger-foreground">{data.query.error}</Text>
      ) : null}
      <View className="min-h-0 flex-1">
        {NativeDiffView && files.length ? (
          <NativeDiffView
            key={readerKey}
            initialRowIndex={
              Platform.OS === "ios" && completedRestoreKey === readerKey
                ? -1
                : initialIndex.index >= 0
                  ? initialIndex.index
                  : undefined
            }
            nativeViewRef={nativeView}
            style={StyleSheet.absoluteFill}
            rowsJson={bridge.rowsJson}
            themeJson={bridge.themeJson}
            styleJson={bridge.styleJson}
            appearanceScheme={themeAppearance}
            contentResetKey={`${props.memoryKey}:${readerKey}`}
            rowHeight={nativeReviewDiffStyle.rowHeight}
            contentWidth={NATIVE_REVIEW_DIFF_CONTENT_WIDTH}
            collapsedFileIdsJson={bridge.collapsedFileIdsJson}
            viewedFileIdsJson={bridge.viewedFileIdsJson}
            showViewedCheckbox={false}
            tokensPatchJson={bridge.tokensPatchJson}
            tokensResetKey={bridge.tokensResetKey}
            refreshing={pullRefreshing}
            onDebug={(event) => {
              bridge.onDebug(event);
              const payload = event.nativeEvent;
              const state = restoreState.current;
              if (
                !state.ready &&
                !state.jumped &&
                restoreAnchor?.kind === "file" &&
                payload.message === "rows-decoded" &&
                payload.rows === rendered.rows.length
              ) {
                const file = rendered.files.find((file) => file.path === restoreAnchor.path);
                if (file) {
                  state.jumped = true;
                  void nativeView.current?.scrollToFile(file.id, false).then(() => {
                    if (restoreState.current !== state) return;
                    state.ready = true;
                    state.waitForPath = null;
                    setCompletedRestoreKey(readerKey);
                  });
                }
              }
              if (
                !state.ready &&
                restoreAnchor?.kind !== "file" &&
                payload.message === "rows-decoded" &&
                payload.rows === rendered.rows.length
              ) {
                state.ready = true;
                setCompletedRestoreKey(readerKey);
              }
              if (
                // Draw metrics include overscan above the viewport; only this
                // event identifies the row the person is actually reading.
                payload.message !== "visible-range" ||
                typeof payload.firstRowIndex !== "number" ||
                typeof payload.lastRowIndex !== "number"
              )
                return;
              if (
                typeof payload.totalRows === "number" &&
                payload.totalRows !== rendered.rows.length
              )
                return;
              const first = payload.firstRowIndex;
              const row = visibleRows[first];
              const file = filesById.get(row?.fileId ?? "");
              if (state.waitForPath !== null) {
                if (file?.path !== state.waitForPath) return;
                state.waitForPath = null;
                state.ready = true;
                state.firstRowIndex = first;
                setCompletedRestoreKey(readerKey);
                return;
              }
              if (!state.ready && restoreIndex < 0 && !data.query.isPending && !data.diff.isPending)
                state.ready = true;
              if (!state.ready) {
                if (
                  restoreIndex < first ||
                  restoreIndex > payload.lastRowIndex ||
                  (restoreAnchor?.kind === "file" && !state.jumped)
                )
                  return;
                state.ready = true;
                state.firstRowIndex = first;
                setCompletedRestoreKey(readerKey);
                return;
              }
              if (state.firstRowIndex === first) return;
              state.firstRowIndex = first;
              if (!row || !file) return;
              rememberWorkingChangesAnchor(props.memoryKey, readerKey, {
                path: file.path,
                kind: row.kind,
                offsetInFile: offsetsInFile.get(row.id) ?? 0,
                oldLineNumber: row.oldLineNumber,
                newLineNumber: row.newLineNumber,
              });
            }}
            onPressLine={commentSelection.onPressLine}
            enableLineRangeSelection
            onSelectLineRange={commentSelection.onSelectLineRange}
            selectedRowIdsJson={bridge.selectedRowIdsJson}
            onVisibleFileChange={({ nativeEvent }) => {
              setVisibleFileId(nativeEvent.fileId ?? null);
              const visiblePath = files.find((file) => file.id === nativeEvent.fileId)?.path;
              data.diff.loadVisibleFile(visiblePath ?? null);
            }}
            onToggleFile={({ nativeEvent }) => {
              if (!nativeEvent.fileId) return;
              const path = files.find((file) => file.id === nativeEvent.fileId)?.path;
              if (!path) return;
              setFolded((current) => {
                const next = new Set(current);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
              });
            }}
            onPressHunk={({ nativeEvent }) => {
              const row = rendered.rows.find((row) => row.id === nativeEvent.rowId);
              const file = files.find((file) => file.id === row?.fileId);
              if (!row || !file) return;
              const patch = reviewHunkPatch(data.hunks.get(file.path) ?? [], row.text ?? "");
              if (patch) void updateStaging(scope, pathsFor(scope, file.path), patch);
            }}
            onPullToRefresh={() => {
              setPullRefreshing(true);
              refresh();
            }}
          />
        ) : (
          <Text className="px-4 py-3 text-xs text-foreground-muted">
            {loadingChanges
              ? "Loading changes…"
              : files.length
                ? "The native diff viewer is unavailable."
                : props.openedFile.path
                  ? "No changes remaining in this file."
                  : `No ${scope} changes.`}
          </Text>
        )}
      </View>
    </View>
  );
}
