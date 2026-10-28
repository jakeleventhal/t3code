import type {
  AnnotationSide,
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  buildFileDiffContentVersion,
  fnv1a32,
  resolveFileDiffPreviousPath,
} from "~/lib/diffRendering";
import { useStableCallback } from "~/hooks/useStableCallback";
import { readLocalApi } from "~/localApi";
import {
  buildDiffReviewComment,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
} from "~/reviewCommentContext";

import { nextFileCommentId } from "../files/fileCommentAnnotations";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";
import { isDiffCommentAnchorCurrent, type DiffCommentAnchor } from "./AnnotatableCodeView.logic";
import { StyledDiffCodeView, type StyledDiffCodeViewOptions } from "./StyledDiffCodeView";

interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
  hunkIndex?: number;
}

type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;
export type AnnotatableCodeViewHandle = CodeViewHandle<DiffCommentAnnotationGroup, undefined>;
const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

function annotationSide(range: SelectedLineRange): AnnotationSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

function selectionPoint(line: HTMLElement) {
  const lineNumber = Number(
    line.getAttribute("data-line") ?? line.getAttribute("data-column-number"),
  );
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  const type = line.getAttribute("data-line-type");
  const side: AnnotationSide =
    type === "change-deletion" ||
    (type !== "change-addition" && line.closest("[data-code]")?.hasAttribute("data-deletions"))
      ? "deletions"
      : "additions";
  return { lineNumber, side };
}

/** Native text dragging and the viewer's gutter selection share the same line actions. */
function selectedTextLines(line: HTMLElement): SelectedLineRange | null {
  const root = line.getRootNode();
  const selection =
    root instanceof ShadowRoot && "getSelection" in root
      ? (root as ShadowRoot & { getSelection(): Selection | null }).getSelection()
      : window.getSelection();
  if (!selection || selection.isCollapsed || !selection.containsNode(line, true)) return null;
  const lineOf = (node: Node | null) =>
    (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-line]");
  const anchor = lineOf(selection.anchorNode);
  const focus = lineOf(selection.focusNode);
  if (!anchor || !focus || anchor.getRootNode() !== root || focus.getRootNode() !== root)
    return null;
  const start = selectionPoint(anchor);
  const end = selectionPoint(focus);
  return start && end
    ? { start: start.lineNumber, side: start.side, end: end.lineNumber, endSide: end.side }
    : null;
}

function appendAnnotationEntry(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  range: SelectedLineRange,
  entry: DiffCommentAnnotationEntry,
): DiffCommentLineAnnotation[] {
  const side = annotationSide(range);
  const annotationIndex = annotations.findIndex(
    (annotation) => annotation.side === side && annotation.lineNumber === range.end,
  );
  if (annotationIndex < 0) {
    return [
      ...annotations,
      {
        side,
        lineNumber: range.end,
        metadata: { entries: [entry] },
      },
    ];
  }
  return annotations.map((annotation, index) =>
    index === annotationIndex
      ? {
          ...annotation,
          metadata: { entries: [...annotation.metadata.entries, entry] },
        }
      : annotation,
  );
}

interface AnnotatableCodeViewProps {
  codeViewKey: string;
  files: ReadonlyArray<{
    fileDiff: FileDiffMetadata;
    filePath: string;
    fileKey: string;
    fileVersion: number;
    collapsed: boolean;
  }>;
  pendingFiles: ReadonlyArray<FileDiffMetadata>;
  isRefreshingDiff: boolean;
  sectionId: string;
  sectionTitle: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  options: StyledDiffCodeViewOptions<DiffCommentAnnotationGroup>;
  viewerRef?: Ref<AnnotatableCodeViewHandle>;
  className?: string;
  renderCodeViewFooter?: () => ReactNode;
  unsafeCSSExtra?: string;
  renderHeaderMetadata?: (fileDiff: FileDiffMetadata) => ReactNode;
  renderHunkAction?: ((fileDiff: FileDiffMetadata, hunkIndex: number) => ReactNode) | undefined;
  stageLinesAction?: "stage" | "unstage" | undefined;
  onStageLines?: ((fileDiff: FileDiffMetadata, range: SelectedLineRange) => void) | undefined;
  canStageLines?: ((fileDiff: FileDiffMetadata, range: SelectedLineRange) => boolean) | undefined;
  onRevertLines?: ((fileDiff: FileDiffMetadata, range: SelectedLineRange) => void) | undefined;
  canRevertLines?: ((fileDiff: FileDiffMetadata, range: SelectedLineRange) => boolean) | undefined;
  renderHeaderFilenameSuffix: (fileDiff: FileDiffMetadata) => ReactNode;
  renderHeaderPrefix: (
    fileDiff: FileDiffMetadata,
    fileKey: string,
    collapsed: boolean,
  ) => ReactNode;
  onRevealSearchMatch: (fileKey: string) => void;
}

interface DiffSelectionContext {
  item: CodeViewItem<DiffCommentAnnotationGroup>;
}

export function AnnotatableCodeView({
  codeViewKey,
  files,
  pendingFiles,
  isRefreshingDiff,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  options,
  viewerRef,
  className,
  renderCodeViewFooter,
  unsafeCSSExtra,
  renderHeaderMetadata,
  renderHunkAction,
  stageLinesAction,
  onStageLines,
  canStageLines,
  onRevertLines,
  canRevertLines,
  renderHeaderFilenameSuffix,
  renderHeaderPrefix,
  onRevealSearchMatch,
}: AnnotatableCodeViewProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const [selectedLines, setSelectedLines] = useState<{
    id: string;
    range: SelectedLineRange;
    anchor: DiffCommentAnchor;
  } | null>(null);
  const [draft, setDraft] = useState<
    | (DiffCommentAnchor & {
        annotation: DiffCommentLineAnnotation;
      })
    | null
  >(null);
  const [draftText, setDraftText] = useState("");
  const renderedFiles = useRef(new Map<string, FileDiffMetadata>());
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const filesByKey = new Map(files.map((file) => [file.fileKey, file]));
  const isCurrentFileRendered = (fileKey: string) => {
    const file = filesByKey.get(fileKey);
    const rendered = renderedFiles.current.get(fileKey);
    return (
      !isRefreshingDiff &&
      file !== undefined &&
      rendered !== undefined &&
      (file.fileDiff === rendered || file.fileVersion === buildFileDiffContentVersion(rendered))
    );
  };
  if (draft !== null && !isDiffCommentAnchorCurrent(draft, filesByKey, pendingFiles)) {
    setDraft(null);
    setDraftText("");
  }
  if (
    selectedLines !== null &&
    !isDiffCommentAnchorCurrent(selectedLines.anchor, filesByKey, pendingFiles)
  ) {
    setSelectedLines(null);
  }
  const items = ((): CodeViewDiffItem<DiffCommentAnnotationGroup>[] =>
    files.map(({ fileDiff, filePath, fileKey, fileVersion, collapsed }) => {
      const persisted = reviewComments
        .filter(
          (comment) =>
            comment.sectionId === sectionId &&
            comment.filePath === filePath &&
            (comment.fenceLanguage ?? "diff") === "diff",
        )
        .reduce<DiffCommentLineAnnotation[]>((annotations, comment) => {
          const range = restoreDiffReviewCommentRange(fileDiff, comment);
          if (!range) return annotations;
          return appendAnnotationEntry(annotations, range, {
            id: comment.id,
            kind: "comment",
            range,
            rangeLabel: comment.rangeLabel,
            text: comment.text,
          });
        }, []);
      const annotations = draft?.fileKey === fileKey ? [...persisted, draft.annotation] : persisted;
      if (renderHunkAction) {
        fileDiff.hunks.forEach((hunk, hunkIndex) => {
          const change = hunk.hunkContent.findLast((content) => content.type === "change");
          if (!change || change.type !== "change") return;
          const additions = change.additions > 0;
          const count = additions ? change.additions : change.deletions;
          if (count === 0) return;
          const lineIndex = additions ? change.additionLineIndex : change.deletionLineIndex;
          const hunkLineIndex = additions ? hunk.additionLineIndex : hunk.deletionLineIndex;
          annotations.push({
            side: additions ? "additions" : "deletions",
            lineNumber:
              (additions ? hunk.additionStart : hunk.deletionStart) +
              lineIndex -
              hunkLineIndex +
              count -
              1,
            metadata: { entries: [], hunkIndex },
          });
        });
      }
      return {
        id: fileKey,
        type: "diff",
        fileDiff,
        annotations,
        collapsed,
        version: fnv1a32(
          `${fileVersion}:${collapsed ? "1" : "0"}:${annotations
            .flatMap((annotation) => [
              String(annotation.metadata.hunkIndex ?? ""),
              ...annotation.metadata.entries.map(
                (entry) => `${entry.id}:${entry.rangeLabel}:${entry.text}`,
              ),
            ])
            .join(":")}`,
        ),
      };
    }))();

  const removeEntry = (entryId: string) => {
    setSelectedLines(null);
    if (draft?.annotation.metadata.entries.some((entry) => entry.id === entryId)) {
      setDraft(null);
      setDraftText("");
    } else {
      removeReviewComment(composerDraftTarget, entryId);
    }
  };

  const submitEntry = useStableCallback((entryId: string, text: string) => {
    const entry = draft?.annotation.metadata.entries.find((candidate) => candidate.id === entryId);
    const file = draft ? filesByKey.get(draft.fileKey) : undefined;
    if (isRefreshingDiff || !entry || !file || draft?.fileVersion !== file.fileVersion) return;
    const comment = buildDiffReviewComment({
      id: entry.id,
      sectionId,
      sectionTitle,
      filePath: file.filePath,
      fileDiff: file.fileDiff,
      range: entry.range,
      text,
    });
    if (comment) addReviewComment(composerDraftTarget, comment);
    setSelectedLines(null);
    setDraft(null);
    setDraftText("");
  });

  const beginComment = useStableCallback(
    (range: SelectedLineRange | null, context: DiffSelectionContext) => {
      if (!range) return;
      const item = context.item;
      if (item.type !== "diff") return;
      const file = filesByKey.get(item.id);
      if (!file || !isCurrentFileRendered(item.id)) return;
      const id = nextFileCommentId();
      const filePath = file.filePath;
      const comment = buildDiffReviewComment({
        id,
        sectionId,
        sectionTitle,
        filePath,
        fileDiff: file.fileDiff,
        range,
        text: "",
      });
      if (!comment) return;
      setDraftText("");
      setDraft({
        fileKey: item.id,
        fileVersion: file.fileVersion,
        filePath,
        previousFilePath: resolveFileDiffPreviousPath(file.fileDiff),
        annotation: {
          side: annotationSide(range),
          lineNumber: range.end,
          metadata: {
            entries: [{ id, kind: "draft", range, rangeLabel: comment.rangeLabel, text: "" }],
          },
        },
      });
    },
  );

  const commitLineAction = useStableCallback(
    (action: string | null, anchor: DiffCommentAnchor, range: SelectedLineRange) => {
      const file = filesByKey.get(anchor.fileKey);
      if (
        !file ||
        !isDiffCommentAnchorCurrent(anchor, filesByKey, pendingFiles) ||
        !isCurrentFileRendered(anchor.fileKey)
      )
        return;
      if (action === "stage-lines") {
        if (
          !onStageLines ||
          !stageLinesAction ||
          (canStageLines && !canStageLines(file.fileDiff, range))
        )
          return;
        setSelectedLines(null);
        onStageLines(file.fileDiff, range);
      } else if (action === "revert-lines") {
        if (!onRevertLines || (canRevertLines && !canRevertLines(file.fileDiff, range))) return;
        setSelectedLines(null);
        onRevertLines(file.fileDiff, range);
      }
    },
  );
  const openContextMenu = useStableCallback((event: MouseEvent, isActive: () => boolean) => {
    const path = event
      .composedPath()
      .filter((entry): entry is HTMLElement => entry instanceof HTMLElement);
    const line = path.find(
      (entry) => entry.hasAttribute("data-line") || entry.hasAttribute("data-column-number"),
    );
    const host = path.find((entry) => entry.dataset.t3DiffFileKey !== undefined);
    const file = host ? filesByKey.get(host.dataset.t3DiffFileKey ?? "") : undefined;
    if (!line || !file || !isCurrentFileRendered(file.fileKey)) return;
    const point = selectionPoint(line);
    if (!point) return;
    const range =
      selectedTextLines(line) ??
      (selectedLines?.id === file.fileKey && line.hasAttribute("data-selected-line")
        ? selectedLines.range
        : { start: point.lineNumber, end: point.lineNumber, side: point.side });
    const stageAvailable =
      onStageLines && stageLinesAction && (!canStageLines || canStageLines(file.fileDiff, range));
    const revertAvailable =
      onRevertLines && (!canRevertLines || canRevertLines(file.fileDiff, range));
    if (!stageAvailable && !revertAvailable) return;
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor: DiffCommentAnchor = {
      fileKey: file.fileKey,
      fileVersion: file.fileVersion,
      filePath: file.filePath,
      previousFilePath: resolveFileDiffPreviousPath(file.fileDiff),
    };
    setSelectedLines({ id: file.fileKey, range, anchor });
    const label = stageLinesAction === "stage" ? "Stage" : "Unstage";
    const singleLine = range.start === range.end && (range.endSide ?? range.side) === range.side;
    void api.contextMenu
      .show(
        [
          ...(stageAvailable
            ? [
                {
                  id: "stage-lines",
                  label: `${label} ${singleLine ? "line" : "selected lines"}`,
                },
              ]
            : []),
          ...(revertAvailable
            ? [{ id: "revert-lines", label: `Revert ${singleLine ? "line" : "selected lines"}` }]
            : []),
        ],
        { x: event.clientX, y: event.clientY },
      )
      .then((action) => {
        if (isActive()) commitLineAction(action, anchor, range);
      });
  });
  const hasLineActions = Boolean(onStageLines || onRevertLines);
  const contextMenuVersion = JSON.stringify(
    files.map(({ fileKey, fileVersion }) => [fileKey, fileVersion]),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Attaches native menu handling and cancels responses when the diff or refresh changes.
  useEffect(() => {
    if (!container || !hasLineActions) return;
    let active = true;
    const listener = (event: MouseEvent) => openContextMenu(event, () => active);
    container.addEventListener("contextmenu", listener);
    return () => {
      active = false;
      container.removeEventListener("contextmenu", listener);
    };
  }, [
    container,
    hasLineActions,
    openContextMenu,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Diff identity, refresh, and stage mode cancel responses from an open native menu.
    codeViewKey,
    isRefreshingDiff,
    contextMenuVersion,
    stageLinesAction,
  ]);

  return (
    <StyledDiffCodeView<DiffCommentAnnotationGroup>
      key={codeViewKey}
      {...(viewerRef ? { viewerRef } : {})}
      {...(className ? { className } : {})}
      {...(unsafeCSSExtra ? { unsafeCSSExtra } : {})}
      {...(renderHeaderMetadata
        ? {
            renderHeaderMetadata: (item: CodeViewItem<DiffCommentAnnotationGroup>) =>
              item.type === "diff" ? renderHeaderMetadata(item.fileDiff) : null,
          }
        : {})}
      {...(renderCodeViewFooter ? { renderCodeViewFooter } : {})}
      items={items}
      containerRef={setContainer}
      selectedLines={selectedLines}
      onSelectedLinesChange={(selection) => {
        if (selection !== null && !isCurrentFileRendered(selection.id)) return;
        const file = selection === null ? undefined : filesByKey.get(selection.id);
        setSelectedLines(
          selection !== null && file !== undefined
            ? {
                ...selection,
                anchor: {
                  fileKey: file.fileKey,
                  fileVersion: file.fileVersion,
                  filePath: file.filePath,
                  previousFilePath: resolveFileDiffPreviousPath(file.fileDiff),
                },
              }
            : null,
        );
      }}
      onRevealSearchMatch={(item) => onRevealSearchMatch(item.id)}
      options={{
        ...options,
        enableGutterUtility: draft === null && !isRefreshingDiff,
        enableLineSelection: draft === null && !isRefreshingDiff,
        onGutterUtilityClick: beginComment,
        onPostRender: (node, _instance, phase, context) => {
          if (phase === "unmount") delete node.dataset.t3DiffFileKey;
          else node.dataset.t3DiffFileKey = context.item.id;
          if (context.type === "diff") {
            if (phase === "unmount") {
              renderedFiles.current.delete(context.item.id);
            } else {
              // At post-render this is the data Pierre just adopted, including retained rows.
              const { fileDiff } = context.instance.__getNextRenderData({
                fileDiff: context.item.fileDiff,
                lineAnnotations: undefined,
              });
              renderedFiles.current.set(context.item.id, fileDiff);
            }
            options.onPostRender?.(node, context.instance, phase, context);
          } else {
            options.onPostRender?.(node, context.instance, phase, context);
          }
        },
      }}
      renderHeaderFilenameSuffix={(item) =>
        item.type === "diff" ? renderHeaderFilenameSuffix(item.fileDiff) : null
      }
      renderHeaderPrefix={(item) =>
        item.type === "diff"
          ? renderHeaderPrefix(item.fileDiff, item.id, item.collapsed === true)
          : null
      }
      renderAnnotation={(...[annotation, , item]) => {
        if (annotation.metadata.hunkIndex !== undefined && item.type === "diff") {
          return renderHunkAction?.(item.fileDiff, annotation.metadata.hunkIndex);
        }
        const hasDraft = annotation.metadata.entries.some((entry) => entry.kind === "draft");
        return (
          <div
            className={hasDraft ? "py-1" : "divide-y divide-border/30 border-y border-border/30"}
          >
            {annotation.metadata.entries.map((entry) => (
              <DiffCommentAnnotation
                key={entry.id}
                kind={entry.kind}
                rangeLabel={entry.rangeLabel}
                text={entry.kind === "draft" ? draftText : entry.text}
                onTextChange={setDraftText}
                onCancel={() => removeEntry(entry.id)}
                onComment={(text) => submitEntry(entry.id, text)}
                pending={isRefreshingDiff}
                onDelete={() => removeEntry(entry.id)}
              />
            ))}
          </div>
        );
      }}
    />
  );
}
