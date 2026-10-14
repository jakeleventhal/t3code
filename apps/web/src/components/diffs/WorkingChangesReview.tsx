import type { FileDiffMetadata } from "@pierre/diffs";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  orderReviewFiles,
  reviewPatchHunks,
  reviewHunkPatch,
  reviewSelectedLinesPatch,
  reviewFolderContains,
} from "@t3tools/client-runtime/review-workspace";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { DraftId } from "~/composerDraftStore";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTheme } from "~/hooks/useTheme";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { createGitDiffFileContentsLoader } from "~/lib/diffFileContents";
import {
  buildFileDiffRenderKey,
  fnv1a32,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { Files, GitBranch, ChevronDown, GitCommitHorizontal, Sparkles } from "lucide";
import { WorkingChangesTree } from "./WorkingChangesTree";
import { Badge } from "../ui/badge";
import { InputGroup, InputGroupAddon } from "../ui/input-group";
import { Group, GroupSeparator } from "../ui/group";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { MorphIcon } from "../MorphIcon";
import { ToggleGroup, Toggle } from "../ui/toggle-group";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./AnnotatableCodeView";
import { DiffFileTree } from "./DiffFileTree";
import { diffFileTreeEntries } from "./diffFileTree.logic";
import { useReviewFilePatches } from "./useReviewFilePatches";
import { applyWorkingChangesMutation, type WorkingChangesState } from "./workingChangesState";

interface WorkingReviewProps {
  environmentId: EnvironmentId;
  cwd: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  wordWrap: boolean;
  split: boolean;
  fileTreeOpen: boolean;
  revision: string | null;
  onChanged: () => void;
  navigationKey?: string;
}

type WorkingScope = "staged" | "unstaged";
type WorkingSelection = { scope: WorkingScope; path: string | null };
type WorkingNavigation = {
  view: "files" | "git";
  selection: WorkingSelection;
  folded: ReadonlySet<string>;
  message: string;
};
// Thread switches unmount the pane, so remember its scoped selection independently of its query cache.
const workingNavigation = new Map<string, WorkingNavigation>();

/** The same diff data powers a combined file list and the index/working-copy trees. */
function useWorkingChanges(
  props: WorkingReviewProps,
  scope: WorkingScope | undefined,
  generation: number,
) {
  const { environmentId, cwd } = props;
  const { resolvedTheme } = useTheme();
  const query = useEnvironmentQuery(
    reviewEnvironment.diffPreview({
      environmentId,
      input: { cwd, ...(scope ? { workingTreeScope: scope } : {}) },
    }),
  );
  const refresh = query.refresh;
  const revision = scope ? props.revision : null;
  useEffect(() => {
    refresh();
  }, [refresh, revision, generation]);
  const source = query.data?.sources.find((source) => source.kind === "working-tree") ?? null;
  const parsed = useMemo(
    () => (source ? getRenderablePatch(source.diff, `${scope}:${source.diffHash}`) : null),
    [scope, source],
  );
  const patches = useReviewFilePatches({
    environmentId,
    cwd,
    source: source?.files ? source : null,
    baseRef: null,
    ignoreWhitespace: false,
    theme: resolvedTheme,
    revision: source?.diffHash,
    preview: parsed,
    workingTreeScope: scope,
  });
  const files = useMemo(
    () => orderReviewFiles(patches.renderableFiles, resolveFileDiffPath),
    [patches.renderableFiles],
  );
  const getContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const loadDiffFiles = useMemo(
    () =>
      createGitDiffFileContentsLoader(getContents, {
        environmentId,
        cwd,
        sourceKind: "working-tree",
        ...(scope ? { workingTreeScope: scope } : {}),
        baseRef: "HEAD",
        headRef: null,
        cacheKey: `${scope ?? "all"}:${source?.diffHash ?? ""}`,
      }),
    [cwd, environmentId, getContents, scope, source?.diffHash],
  );
  const hunksByPath = useMemo(
    () =>
      new Map(
        [...(source ? [source.diff] : []), ...patches.rawPatches]
          .flatMap((patch) => reviewPatchHunks(patch))
          .flatMap((entry) => {
            const parsed = getRenderablePatch(
              entry.filePatch,
              `${scope}:${fnv1a32(entry.filePatch)}`,
            );
            return parsed?.kind === "files"
              ? parsed.files.map((file) => [resolveFileDiffPath(file), entry.hunks] as const)
              : [];
          }),
      ),
    [source, scope, patches.rawPatches],
  );
  return { files, patches, query, loadDiffFiles, hunksByPath };
}

export function WorkingChangesReview(props: WorkingReviewProps) {
  const { environmentId, cwd, composerDraftTarget, fileTreeOpen } = props;
  const { resolvedTheme } = useTheme();
  const [generation, setGeneration] = useState(0);
  const navigationKey = props.navigationKey ?? JSON.stringify([environmentId, composerDraftTarget]);
  const remembered = workingNavigation.get(navigationKey);
  const [view, setView] = useState<"files" | "git">(remembered?.view ?? "git");
  const [selection, setSelection] = useState<WorkingSelection>(
    remembered?.selection ?? { scope: "unstaged", path: null },
  );
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => remembered?.folded ?? new Set());
  const [pending, setPending] = useState(false);
  const [viewer, setViewer] = useState<AnnotatableCodeViewHandle | null>(null);
  const [message, setMessage] = useState(remembered?.message ?? "");
  useLayoutEffect(() => {
    workingNavigation.set(navigationKey, { view, selection, folded, message });
  }, [navigationKey, view, selection, folded, message]);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [reverting, setReverting] = useState<{ paths: string[]; label: string } | null>(null);
  const all = useWorkingChanges(props, undefined, generation);
  const staged = useWorkingChanges(props, "staged", generation);
  const unstaged = useWorkingChanges(props, "unstaged", generation);
  const [optimistic, setOptimistic] = useState<{
    state: WorkingChangesState;
    confirmed: boolean;
    stagedBefore: typeof staged.query.data;
    unstagedBefore: typeof unstaged.query.data;
    stagedUpdatedAt: number;
    unstagedUpdatedAt: number;
  } | null>(null);
  const busy = useRef(false);
  const refreshedScopes = useRef({ staged: false, unstaged: false });
  const queryData = useRef({
    staged: staged.query.data,
    unstaged: unstaged.query.data,
    stagedUpdatedAt: staged.query.dataUpdatedAt,
    unstagedUpdatedAt: unstaged.query.dataUpdatedAt,
  });
  useLayoutEffect(() => {
    queryData.current = {
      staged: staged.query.data,
      unstaged: unstaged.query.data,
      stagedUpdatedAt: staged.query.dataUpdatedAt,
      unstagedUpdatedAt: unstaged.query.dataUpdatedAt,
    };
  }, [
    staged.query.data,
    unstaged.query.data,
    staged.query.dataUpdatedAt,
    unstaged.query.dataUpdatedAt,
  ]);
  useEffect(() => {
    if (!optimistic?.confirmed) return;
    if (staged.query.isPending) refreshedScopes.current.staged = true;
    if (unstaged.query.isPending) refreshedScopes.current.unstaged = true;
    if (staged.query.isPending || unstaged.query.isPending) return;
    // A successful write stays projected if reading Git fails. Let the reader retry
    // without trapping every action behind a pending flag or rolling back the write.
    if (staged.query.error || unstaged.query.error) {
      busy.current = false;
      setPending(false);
      return;
    }
    if (staged.patches.isPending || unstaged.patches.isPending) return;
    const stagedFresh =
      staged.query.dataUpdatedAt > optimistic.stagedUpdatedAt ||
      staged.query.data !== optimistic.stagedBefore ||
      refreshedScopes.current.staged;
    const unstagedFresh =
      unstaged.query.dataUpdatedAt > optimistic.unstagedUpdatedAt ||
      unstaged.query.data !== optimistic.unstagedBefore ||
      refreshedScopes.current.unstaged;
    if (stagedFresh && unstagedFresh) {
      setOptimistic(null);
      busy.current = false;
      setPending(false);
    }
  }, [
    optimistic,
    staged.query.data,
    unstaged.query.data,
    staged.query.dataUpdatedAt,
    unstaged.query.dataUpdatedAt,
    staged.query.isPending,
    unstaged.query.isPending,
    staged.query.error,
    unstaged.query.error,
    staged.patches.isPending,
    unstaged.patches.isPending,
  ]);
  const scopes = {
    staged: { ...staged, ...(optimistic?.state.staged ?? {}) },
    unstaged: { ...unstaged, ...(optimistic?.state.unstaged ?? {}) },
  };
  const scope = selection.scope;
  const selectedPath =
    selection.path &&
    (view === "files" ? all.files : scopes[scope].files).some(
      (file) => resolveFileDiffPath(file) === selection.path,
    )
      ? selection.path
      : null;
  const data = view === "files" ? all : scopes[scope];
  const files = useMemo(
    () =>
      view === "git" && selectedPath
        ? data.files.filter((file) => resolveFileDiffPath(file) === selectedPath)
        : data.files,
    [data.files, view, selectedPath],
  );
  const requestFile = data.patches.requestFile;
  useEffect(() => {
    if (!selectedPath) return;
    const index = data.files.findIndex((file) => resolveFileDiffPath(file) === selectedPath);
    if (index >= 0) requestFile(index);
  }, [data.files, requestFile, selectedPath]);
  const changedCount = useMemo(
    () => new Set([...scopes.staged.files, ...scopes.unstaged.files].map(resolveFileDiffPath)).size,
    [scopes.staged.files, scopes.unstaged.files],
  );
  const stagedEntries = useMemo(
    () => diffFileTreeEntries(scopes.staged.files),
    [scopes.staged.files],
  );
  const unstagedEntries = useMemo(
    () => diffFileTreeEntries(scopes.unstaged.files),
    [scopes.unstaged.files],
  );
  const canCommit = useAtomValue(reviewEnvironment.commit.permissionAtom(environmentId));
  const canRevert = useAtomValue(reviewEnvironment.revert.permissionAtom(environmentId));
  const commit = useAtomCommand(reviewEnvironment.commit, { reportFailure: false });
  const revert = useAtomCommand(reviewEnvironment.revert, { reportFailure: false });
  const canGenerate = useAtomValue(
    reviewEnvironment.generateCommitMessage.permissionAtom(environmentId),
  );
  const generateMessage = useAtomCommand(reviewEnvironment.generateCommitMessage, {
    reportFailure: false,
  });
  const generatePreview = async () => {
    if (pending || !canGenerate || staged.files.length === 0) return;
    setPending(true);
    setGeneratingMessage(true);
    const result = await generateMessage({ environmentId, input: { cwd } });
    setPending(false);
    setGeneratingMessage(false);
    if (result._tag === "Success") setMessage(result.value);
    else
      toastManager.add({
        type: "error",
        title: "Could not generate a commit message",
        description: "Check your source-control writing model in Settings and try again.",
      });
  };
  const runCommit = async (action: "commit" | "amend" | "commit-push" = "commit") => {
    if (
      pending ||
      !canCommit ||
      (staged.files.length === 0 && (action !== "amend" || !message.trim()))
    )
      return;
    setPending(true);
    const result = await commit({ environmentId, input: { cwd, message, action } });
    setPending(false);
    setGeneration((value) => value + 1);
    props.onChanged();
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not commit",
        description:
          "Check your staged changes and Git or source-control writer settings, then try again.",
      });
    } else {
      setMessage("");
      toastManager.add({
        type: result.value.pushStatus === "failed" ? "error" : "success",
        title:
          result.value.pushStatus === "failed"
            ? "Committed, but push failed"
            : result.value.pushStatus === "pushed"
              ? "Committed and pushed"
              : "Committed",
        description:
          result.value.pushStatus === "failed"
            ? "Your commit is saved locally. Check the remote connection and retry pushing from the Git menu."
            : result.value.commitSha.slice(0, 7),
      });
    }
  };
  const runRevert = async () => {
    if (busy.current || pending || !canRevert || !reverting) return;
    busy.current = true;
    refreshedScopes.current = { staged: false, unstaged: false };
    setPending(true);
    setOptimistic({
      state: applyWorkingChangesMutation(scopes, all, {
        scope: "unstaged",
        paths: reverting.paths,
        revert: true,
      }),
      confirmed: false,
      stagedBefore: staged.query.data,
      unstagedBefore: unstaged.query.data,
      stagedUpdatedAt: staged.query.dataUpdatedAt,
      unstagedUpdatedAt: unstaged.query.dataUpdatedAt,
    });
    const result = await revert({ environmentId, input: { cwd, paths: reverting.paths } });
    setReverting(null);
    if (result._tag === "Failure") {
      setOptimistic(null);
      busy.current = false;
      setPending(false);
      toastManager.add({
        type: "error",
        title: "Could not revert changes",
        description: "Refresh the diff and try again.",
      });
    } else {
      setOptimistic((current) =>
        current
          ? {
              ...current,
              confirmed: true,
              stagedBefore: queryData.current.staged,
              unstagedBefore: queryData.current.unstaged,
              stagedUpdatedAt: queryData.current.stagedUpdatedAt,
              unstagedUpdatedAt: queryData.current.unstagedUpdatedAt,
            }
          : null,
      );
      props.onChanged();
    }
    setGeneration((value) => value + 1);
  };
  const canStage = useAtomValue(reviewEnvironment.setStaged.permissionAtom(environmentId));
  const stage = useAtomCommand(reviewEnvironment.setStaged, { reportFailure: false });
  const updateStaging = async (scope: WorkingScope, paths: string[], patch?: string) => {
    if (busy.current || pending || !canStage || paths.length === 0) return;
    busy.current = true;
    refreshedScopes.current = { staged: false, unstaged: false };
    setPending(true);
    const beforeSelection = selection;
    setOptimistic({
      state: applyWorkingChangesMutation(scopes, all, {
        scope,
        paths,
        ...(patch ? { patch } : {}),
      }),
      confirmed: false,
      stagedBefore: staged.query.data,
      unstagedBefore: unstaged.query.data,
      stagedUpdatedAt: staged.query.dataUpdatedAt,
      unstagedUpdatedAt: unstaged.query.dataUpdatedAt,
    });
    if (!patch && selection.path && paths.includes(selection.path)) {
      setSelection({ scope: scope === "unstaged" ? "staged" : "unstaged", path: selection.path });
    }
    const result = await stage({
      environmentId,
      input: {
        cwd,
        paths: [...new Set(paths)],
        staged: scope === "unstaged",
        ...(patch === undefined ? {} : { patch }),
      },
    });
    if (result._tag === "Failure") {
      setOptimistic(null);
      setSelection(beforeSelection);
      busy.current = false;
      setPending(false);
      toastManager.add({
        type: "error",
        title: "Could not update staging",
        description: "The file may have changed. Refresh the diff and try again.",
      });
    } else {
      setOptimistic((current) =>
        current
          ? {
              ...current,
              confirmed: true,
              stagedBefore: queryData.current.staged,
              unstagedBefore: queryData.current.unstaged,
              stagedUpdatedAt: queryData.current.stagedUpdatedAt,
              unstagedUpdatedAt: queryData.current.unstagedUpdatedAt,
            }
          : null,
      );
      props.onChanged();
    }
    setGeneration((value) => value + 1);
  };
  const stagingPaths = (scope: WorkingScope, path: string) =>
    scopes[scope].files.flatMap((file) =>
      resolveFileDiffPath(file) === path || reviewFolderContains(path, resolveFileDiffPath(file))
        ? [resolveFileDiffPath(file), ...(file.prevName ? [file.prevName] : [])]
        : [],
    );
  const selectFile = (scope: WorkingScope, path: string) => {
    setSelection({ scope, path });
    const target = view === "files" ? all : scopes[scope];
    const index = target.files.findIndex((file) => resolveFileDiffPath(file) === path);
    if (index < 0) return;
    target.patches.requestFile(index);
    setFolded((current) => new Set([...current].filter((entry) => entry !== path)));
    if (view === "files")
      viewer?.scrollTo({
        type: "item",
        id: buildFileDiffRenderKey(target.files[index]!),
        align: "start",
      });
  };
  const width = useResizableWidth({
    storageKey: "t3code:working-diff-tree-width",
    defaultWidth: 320,
    minWidth: 192,
    maxWidth: 640,
    edge: "left",
  });
  const codeFiles = useMemo(
    () =>
      files.map((fileDiff) => ({
        fileDiff,
        filePath: resolveFileDiffPath(fileDiff),
        fileKey: buildFileDiffRenderKey(fileDiff),
        fileVersion: fnv1a32(JSON.stringify(fileDiff)),
        collapsed:
          folded.has(resolveFileDiffPath(fileDiff)) ||
          fileDiff.cacheKey?.endsWith(":pending") === true,
      })),
    [files, folded],
  );
  const renderActions = (file: FileDiffMetadata) => {
    const path = resolveFileDiffPath(file);
    if (view === "files") return null;
    return (
      <>
        <Button
          size="xs"
          variant="outline"
          disabled={!canStage || pending}
          aria-label={`${scope === "unstaged" ? "Stage" : "Unstage"} ${path}`}
          onClick={() => void updateStaging(scope, stagingPaths(scope, path))}
        >
          {scope === "unstaged" ? "Stage file" : "Unstage file"}
        </Button>
      </>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs text-muted-foreground">
          {view === "git" ? (scope === "staged" ? "Staged" : "Unstaged") : "All changed files"}
          {!fileTreeOpen ? (
            <ToggleGroup
              value={[view]}
              onValueChange={(values) => {
                const next = values[0];
                if (next === "files" || next === "git") setView(next);
              }}
              aria-label="Change navigation"
            >
              <Toggle value="files">Files</Toggle>
              <Toggle value="git">
                Git{" "}
                <Badge size="sm" variant="info" aria-label={`${changedCount} changed files`}>
                  {changedCount}
                </Badge>
              </Toggle>
            </ToggleGroup>
          ) : null}
        </div>
        {data.query.error ? (
          <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs">
            <p>{data.query.error}</p>
            <Button size="xs" variant="outline" onClick={() => setGeneration((value) => value + 1)}>
              Retry
            </Button>
          </div>
        ) : null}
        {files.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {!optimistic && data.query.isPending ? "Loading changes…" : "No changes."}
          </p>
        ) : (
          <AnnotatableCodeView
            codeViewKey={`${cwd}:${view}:${view === "git" ? `${scope}:${selectedPath ?? "all"}` : "all"}`}
            sectionId={view === "git" ? scope : "working-tree"}
            sectionTitle={view === "git" ? scope : "Uncommitted"}
            composerDraftTarget={composerDraftTarget}
            files={codeFiles}
            viewerRef={setViewer}
            className="min-h-0 flex-1 overflow-auto"
            stageLinesAction={
              view === "git" ? (scope === "unstaged" ? "stage" : "unstage") : undefined
            }
            canStageLines={(file, range) =>
              canStage &&
              !pending &&
              Boolean(
                reviewSelectedLinesPatch(
                  data.hunksByPath.get(resolveFileDiffPath(file)) ?? [],
                  range,
                  scope === "staged",
                  props.split ? "split" : "unified",
                ),
              )
            }
            onStageLines={
              view === "git"
                ? (file, range) => {
                    const path = resolveFileDiffPath(file);
                    const patch = reviewSelectedLinesPatch(
                      data.hunksByPath.get(path) ?? [],
                      range,
                      scope === "staged",
                      props.split ? "split" : "unified",
                    );
                    if (patch) void updateStaging(scope, stagingPaths(scope, path), patch);
                  }
                : undefined
            }
            renderHunkAction={
              view === "git"
                ? (file, index) => {
                    const path = resolveFileDiffPath(file);
                    const patch = reviewHunkPatch(
                      data.hunksByPath.get(path) ?? [],
                      file.hunks[index]?.hunkSpecs ?? "",
                    );
                    return patch ? (
                      <div className="flex justify-end px-3 py-0.5 font-sans">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!canStage || pending}
                          aria-label={`${scope === "unstaged" ? "Stage" : "Unstage"} hunk ${index + 1} in ${path}`}
                          onClick={() =>
                            void updateStaging(scope, stagingPaths(scope, path), patch)
                          }
                        >
                          {scope === "unstaged" ? "Stage hunk" : "Unstage hunk"}
                        </Button>
                      </div>
                    ) : null;
                  }
                : undefined
            }
            renderHeaderFilenameSuffix={renderActions}
            renderHeaderPrefix={(file) => (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Toggle ${resolveFileDiffPath(file)}`}
                onClick={() =>
                  setFolded((current) => {
                    const next = new Set(current);
                    const path = resolveFileDiffPath(file);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
              >
                {folded.has(resolveFileDiffPath(file)) ? "▸" : "▾"}
              </Button>
            )}
            onRevealSearchMatch={(key) => {
              const file = files.find((file) => buildFileDiffRenderKey(file) === key);
              if (file)
                setFolded(
                  (current) =>
                    new Set([...current].filter((path) => path !== resolveFileDiffPath(file))),
                );
            }}
            options={{
              diffStyle: props.split ? "split" : "unified",
              overflow: props.wordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
              ...(optimistic ? {} : { loadDiffFiles: data.loadDiffFiles }),
            }}
          />
        )}
        {data.patches.settledFileCount < data.files.length && !selectedPath ? (
          <Button size="xs" variant="ghost" onClick={data.patches.loadNextFiles}>
            Load more files
          </Button>
        ) : null}
      </div>
      {fileTreeOpen ? (
        <aside
          aria-label="Changed files panel"
          className="relative flex w-(--resizable-width) min-w-48 max-w-[60%] shrink-0 flex-col border-l border-border/60"
          style={{ "--resizable-width": `${width.width}px` } as React.CSSProperties}
        >
          <RightPanelResizeHandle handlers={width.handlers} />
          <div className="flex h-8 shrink-0 items-center border-b border-border/60 px-2">
            <ToggleGroup
              value={[view]}
              onValueChange={(values) => {
                const next = values[0];
                if (next === "files" || next === "git") setView(next);
              }}
              aria-label="Change navigation"
            >
              <Toggle value="files">
                <MorphIcon icon={Files} />
                Files
              </Toggle>
              <Toggle value="git">
                <MorphIcon icon={GitBranch} />
                Git
                <Badge size="sm" variant="info" aria-label={`${changedCount} changed files`}>
                  {changedCount}
                </Badge>
              </Toggle>
            </ToggleGroup>
          </div>
          {view === "files" ? (
            <DiffFileTree
              ariaLabel="Changed files"
              entries={diffFileTreeEntries(all.files)}
              selectedPath={selectedPath}
              onSelectFile={(path) =>
                selectFile(
                  unstaged.files.some((file) => resolveFileDiffPath(file) === path)
                    ? "unstaged"
                    : "staged",
                  path,
                )
              }
            />
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-1 px-2 py-1.5">
                <InputGroup size="compact" aria-label="Commit message field">
                  <textarea
                    className="field-sizing-content block min-h-7 w-full min-w-0 resize-none border-0 bg-transparent px-2.5 py-1 font-sans text-xs leading-5 text-foreground outline-none placeholder:text-placeholder"
                    rows={1}
                    aria-label="Commit message"
                    placeholder="Message (blank generates one)"
                    value={message}
                    disabled={pending || !canCommit}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        void runCommit();
                      }
                    }}
                  />
                  {staged.files.length > 0 ? (
                    <InputGroupAddon align="inline-end">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={pending || !canGenerate}
                        aria-label="Generate commit message"
                        aria-busy={generatingMessage}
                        onClick={() => void generatePreview()}
                      >
                        <MorphIcon icon={Sparkles} />
                      </Button>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
                <Group className="w-full" aria-label="Commit actions">
                  <Button
                    size="sm"
                    className="min-w-0 flex-1"
                    disabled={pending || !canCommit || staged.files.length === 0}
                    onClick={() => void runCommit()}
                  >
                    <MorphIcon icon={GitCommitHorizontal} />
                    {generatingMessage
                      ? "Generating…"
                      : pending && !optimistic
                        ? "Working…"
                        : "Commit"}
                  </Button>
                  <GroupSeparator />
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          disabled={pending || !canCommit}
                          aria-label="Commit options"
                        />
                      }
                    >
                      <MorphIcon icon={ChevronDown} />
                    </MenuTrigger>
                    <MenuPopup>
                      {(["commit", "amend", "commit-push"] as const).map((action) => (
                        <MenuItem
                          key={action}
                          disabled={
                            pending ||
                            !canCommit ||
                            (staged.files.length === 0 && (action !== "amend" || !message.trim()))
                          }
                          onClick={() => void runCommit(action)}
                        >
                          {action === "amend"
                            ? "Commit (Amend)"
                            : action === "commit-push"
                              ? "Commit & Push"
                              : "Commit"}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                </Group>
              </div>
              <WorkingChangesTree
                staged={stagedEntries}
                unstaged={unstagedEntries}
                selected={selectedPath ? { scope, path: selectedPath } : null}
                disabled={!canStage || pending}
                revertDisabled={!canRevert || pending}
                onSelect={selectFile}
                onViewAll={(scope) => {
                  setSelection({ scope, path: null });
                  setView("git");
                }}
                onStage={(scope, path) =>
                  void updateStaging(
                    scope,
                    path === null
                      ? scopes[scope].files.flatMap((file) => [
                          resolveFileDiffPath(file),
                          ...(file.prevName ? [file.prevName] : []),
                        ])
                      : stagingPaths(scope, path),
                  )
                }
                onRevert={(path) =>
                  setReverting({
                    paths: scopes.unstaged.files
                      .filter(
                        (file) =>
                          path === null ||
                          resolveFileDiffPath(file) === path ||
                          reviewFolderContains(path, resolveFileDiffPath(file)),
                      )
                      .map(resolveFileDiffPath),
                    label: path ?? "all unstaged changes",
                  })
                }
              />
            </>
          )}
        </aside>
      ) : null}
      <Dialog
        open={reverting !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setReverting(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Revert unstaged changes?</DialogTitle>
            <DialogDescription>
              This discards unstaged edits in {reverting?.label}. Staged changes are kept. Selected
              new, untracked files will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setReverting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !canRevert || !reverting?.paths.length}
              onClick={() => void runRevert()}
            >
              Revert changes
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
