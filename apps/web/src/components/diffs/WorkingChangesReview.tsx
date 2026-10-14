import type { FileDiffMetadata } from "@pierre/diffs";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  orderReviewFiles,
  reviewPatchHunks,
  reviewHunkPatch,
  reviewFolderContains,
} from "@t3tools/client-runtime/review-workspace";
import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "../ui/textarea";
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

interface WorkingReviewProps {
  environmentId: EnvironmentId;
  cwd: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  wordWrap: boolean;
  split: boolean;
  fileTreeOpen: boolean;
  revision: string | null;
  onChanged: () => void;
}

type WorkingScope = "staged" | "unstaged";

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
  useEffect(() => {
    refresh();
  }, [refresh, props.revision, generation]);
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
  const [view, setView] = useState<"files" | "git">("git");
  const [selection, setSelection] = useState<{ scope: WorkingScope; path: string } | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [viewer, setViewer] = useState<AnnotatableCodeViewHandle | null>(null);
  const [message, setMessage] = useState("");
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [reverting, setReverting] = useState<{ paths: string[]; label: string } | null>(null);
  const all = useWorkingChanges(props, undefined, generation);
  const staged = useWorkingChanges(props, "staged", generation);
  const unstaged = useWorkingChanges(props, "unstaged", generation);
  const scopes = { staged, unstaged };
  const selected =
    selection &&
    scopes[selection.scope].files.some((file) => resolveFileDiffPath(file) === selection.path)
      ? selection
      : selection &&
          scopes[selection.scope === "staged" ? "unstaged" : "staged"].files.some(
            (file) => resolveFileDiffPath(file) === selection.path,
          )
        ? {
            ...selection,
            scope: selection.scope === "staged" ? ("unstaged" as const) : ("staged" as const),
          }
        : null;
  const scope = selected?.scope ?? (unstaged.files.length > 0 ? "unstaged" : "staged");
  const data = view === "files" ? all : scopes[scope];
  const files = useMemo(
    () =>
      view === "git"
        ? data.files.filter(
            (file) => resolveFileDiffPath(file) === (selected?.path ?? data.files[0]?.name),
          )
        : data.files,
    [data.files, view, selected?.path],
  );
  const selectedPath =
    selected?.path ??
    (view === "git" ? (data.files[0] ? resolveFileDiffPath(data.files[0]) : null) : null);
  const requestFile = data.patches.requestFile;
  useEffect(() => {
    if (!selectedPath) return;
    const index = data.files.findIndex((file) => resolveFileDiffPath(file) === selectedPath);
    if (index >= 0) requestFile(index);
  }, [data.files, requestFile, selectedPath]);
  const changedCount = useMemo(
    () => new Set([...staged.files, ...unstaged.files].map(resolveFileDiffPath)).size,
    [staged.files, unstaged.files],
  );
  const stagedEntries = useMemo(() => diffFileTreeEntries(staged.files), [staged.files]);
  const unstagedEntries = useMemo(() => diffFileTreeEntries(unstaged.files), [unstaged.files]);
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
    if (pending || !canRevert || !reverting) return;
    setPending(true);
    const result = await revert({ environmentId, input: { cwd, paths: reverting.paths } });
    setPending(false);
    setReverting(null);
    setGeneration((value) => value + 1);
    props.onChanged();
    if (result._tag === "Failure")
      toastManager.add({
        type: "error",
        title: "Could not revert changes",
        description: "Refresh the diff and try again.",
      });
  };
  const canStage = useAtomValue(reviewEnvironment.setStaged.permissionAtom(environmentId));
  const stage = useAtomCommand(reviewEnvironment.setStaged, { reportFailure: false });
  const updateStaging = async (scope: WorkingScope, paths: string[], patch?: string) => {
    if (pending || !canStage || paths.length === 0) return;
    setPending(true);
    const result = await stage({
      environmentId,
      input: {
        cwd,
        paths: [...new Set(paths)],
        staged: scope === "unstaged",
        ...(patch === undefined ? {} : { patch }),
      },
    });
    setPending(false);
    setGeneration((value) => value + 1);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not update staging",
        description: "The file may have changed. Refresh the diff and try again.",
      });
      return;
    }
    if (patch === undefined && paths.length > 0) {
      setSelection((current) => ({
        scope: scope === "unstaged" ? "staged" : "unstaged",
        path: current && paths.includes(current.path) ? current.path : paths[0]!,
      }));
    }
    props.onChanged();
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
          {view === "git"
            ? scope === "staged"
              ? "Staged changes"
              : "Unstaged changes"
            : "All changed files"}
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
        {data.query.error ? <p className="px-3 py-2 text-xs">{data.query.error}</p> : null}
        {files.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {data.query.isPending ? "Loading changes…" : "No changes."}
          </p>
        ) : (
          <AnnotatableCodeView
            codeViewKey={`${cwd}:${view}:${view === "git" ? `${scope}:${selected?.path ?? ""}` : "all"}`}
            sectionId={view === "git" ? scope : "working-tree"}
            sectionTitle={view === "git" ? scope : "Uncommitted"}
            composerDraftTarget={composerDraftTarget}
            files={codeFiles}
            viewerRef={setViewer}
            className="min-h-0 flex-1 overflow-auto"
            renderHunkAction={
              view === "git"
                ? (file, index) => {
                    const path = resolveFileDiffPath(file);
                    const patch = reviewHunkPatch(
                      data.hunksByPath.get(path) ?? [],
                      file.hunks[index]?.hunkSpecs ?? "",
                    );
                    return patch ? (
                      <div className="flex justify-end border-y border-border/30 bg-muted/40 px-3 py-1 font-sans">
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
              loadDiffFiles: data.loadDiffFiles,
            }}
          />
        )}
        {view === "files" && all.patches.settledFileCount < all.files.length ? (
          <Button size="xs" variant="ghost" onClick={all.patches.loadNextFiles}>
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
              selectedPath={selected?.path ?? null}
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
                  <Textarea
                    unstyled
                    size="sm"
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
                    {generatingMessage ? "Generating…" : pending ? "Working…" : "Commit"}
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
                    paths: unstaged.files
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
