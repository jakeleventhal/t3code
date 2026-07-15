import type { EnvironmentId, ProjectContentMatch } from "@t3tools/contracts";
import { getFiletypeFromFileName } from "@pierre/diffs";
import { LoaderCircle, Search } from "lucide-react";
import {
  Suspense,
  Component,
  use,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";

import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

const SEARCH_RESULT_LIMIT = 500;
const SEARCH_DEBOUNCE_MS = 120;
const EMPTY_MATCHES: ReadonlyArray<ProjectContentMatch> = [];

interface ProjectContentSearchDialogProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenMatch: (relativePath: string, lineNumber: number) => void;
}

interface MatchGroup {
  readonly path: string;
  readonly matches: ReadonlyArray<ProjectContentMatch & { readonly resultIndex: number }>;
}

class SearchSyntaxErrorBoundary extends Component<
  { readonly children: ReactNode; readonly fallback: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function splitPath(path: string): { readonly name: string; readonly directory: string } {
  const separator = path.lastIndexOf("/");
  return separator === -1
    ? { name: path, directory: "" }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
}

function groupMatches(matches: ReadonlyArray<ProjectContentMatch>): MatchGroup[] {
  const groups = new Map<string, Array<ProjectContentMatch & { readonly resultIndex: number }>>();
  matches.forEach((match, resultIndex) => {
    const group = groups.get(match.path);
    const indexedMatch = { ...match, resultIndex };
    if (group) {
      group.push(indexedMatch);
    } else {
      groups.set(match.path, [indexedMatch]);
    }
  });
  return [...groups].map(([path, groupedMatches]) => ({ path, matches: groupedMatches }));
}

function normalizedMatchRanges(match: ProjectContentMatch) {
  return match.matchRanges
    .map((range) => ({
      start: Math.max(0, Math.min(match.lineContent.length, range.start)),
      end: Math.max(0, Math.min(match.lineContent.length, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .toSorted((left, right) => left.start - right.start);
}

function highlightedLine(match: ProjectContentMatch): ReactNode {
  const ranges = normalizedMatchRanges(match);
  if (ranges.length === 0) return match.lineContent;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) {
      parts.push(match.lineContent.slice(cursor, range.start));
    }
    const start = Math.max(cursor, range.start);
    if (range.end > start) {
      parts.push(
        <mark
          className="rounded-[2px] bg-primary/22 text-inherit"
          key={`match-${range.start}-${range.end}`}
        >
          {match.lineContent.slice(start, range.end)}
        </mark>,
      );
    }
    cursor = Math.max(cursor, range.end);
  });
  if (cursor < match.lineContent.length) {
    parts.push(match.lineContent.slice(cursor));
  }
  return parts;
}

function tokenStyle(token: {
  readonly color?: string;
  readonly fontStyle?: number;
}): CSSProperties {
  const fontStyle = token.fontStyle ?? 0;
  return {
    ...(token.color ? { color: token.color } : {}),
    ...(fontStyle & 1 ? { fontStyle: "italic" } : {}),
    ...(fontStyle & 2 ? { fontWeight: 700 } : {}),
    ...(fontStyle & 4 ? { textDecoration: "underline" } : {}),
  };
}

function SyntaxHighlightedLine(props: {
  readonly match: ProjectContentMatch;
  readonly language: string;
  readonly themeName: ReturnType<typeof resolveDiffThemeName>;
}) {
  const highlighter = use(getSyntaxHighlighterPromise(props.language));
  const tokens = useMemo(() => {
    try {
      return highlighter.codeToTokens(props.match.lineContent, {
        lang: props.language,
        theme: props.themeName,
      }).tokens[0];
    } catch {
      return undefined;
    }
  }, [highlighter, props.language, props.match.lineContent, props.themeName]);

  if (!tokens || tokens.length === 0) return highlightedLine(props.match);

  const ranges = normalizedMatchRanges(props.match);
  return tokens.map((token, tokenIndex) => {
    const tokenStart = token.offset;
    const tokenEnd = tokenStart + token.content.length;
    const boundaries = [
      tokenStart,
      tokenEnd,
      ...ranges.flatMap((range) => [
        Math.max(tokenStart, Math.min(tokenEnd, range.start)),
        Math.max(tokenStart, Math.min(tokenEnd, range.end)),
      ]),
    ].toSorted((left, right) => left - right);
    const uniqueBoundaries = boundaries.filter(
      (boundary, index) => index === 0 || boundary !== boundaries[index - 1],
    );

    return uniqueBoundaries.slice(0, -1).map((start, segmentIndex) => {
      const end = uniqueBoundaries[segmentIndex + 1] ?? start;
      if (end <= start) return null;
      const content = props.match.lineContent.slice(start, end);
      const isMatch = ranges.some((range) => range.start < end && range.end > start);
      const key = `${tokenIndex}:${start}:${end}`;
      return isMatch ? (
        <mark
          className="rounded-[2px] bg-primary/25 text-inherit"
          key={key}
          style={tokenStyle(token)}
        >
          {content}
        </mark>
      ) : (
        <span key={key} style={tokenStyle(token)}>
          {content}
        </span>
      );
    });
  });
}

function SearchOptionButton(props: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[5px] font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        props.active && "bg-accent text-foreground shadow-sm",
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function ProjectContentSearchDialog(props: ProjectContentSearchDialogProps) {
  const { resolvedTheme } = useTheme();
  const themeName = resolveDiffThemeName(resolvedTheme);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setDebouncedQuery("");
      return;
    }
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [props.open, query]);

  const search = useEnvironmentQuery(
    props.open && debouncedQuery.length > 0
      ? projectEnvironment.searchContents({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            query: debouncedQuery,
            limit: SEARCH_RESULT_LIMIT,
            caseSensitive,
            wholeWord,
            useRegex,
          },
        })
      : null,
  );
  const matches = search.data?.matches ?? EMPTY_MATCHES;
  const groups = useMemo(() => groupMatches(matches), [matches]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [matches]);

  useEffect(() => {
    document
      .querySelector<HTMLElement>(`[data-project-search-result="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const openMatch = (match: ProjectContentMatch) => {
    props.onOpenChange(false);
    props.onOpenMatch(match.path, match.lineNumber);
  };
  const fileCount = groups.length;
  const waitingForDebounce = query.trim().length > 0 && query.trim() !== debouncedQuery;
  const isPending = waitingForDebounce || search.isPending;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup
        className="h-[min(44rem,82vh)] max-w-3xl overflow-hidden"
        data-project-search
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        <DialogTitle className="sr-only">Search {props.projectName}</DialogTitle>
        <div className="flex shrink-0 items-center gap-2 border-b p-2">
          <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            nativeInput
            unstyled
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && matches.length > 0) {
                event.preventDefault();
                setSelectedIndex((current) => (current + 1) % matches.length);
              } else if (event.key === "ArrowUp" && matches.length > 0) {
                event.preventDefault();
                setSelectedIndex((current) => (current - 1 + matches.length) % matches.length);
              } else if (event.key === "Enter") {
                const match = matches[selectedIndex];
                if (match) {
                  event.preventDefault();
                  openMatch(match);
                }
              }
            }}
            className="h-9 min-w-0 flex-1 px-2 font-mono text-sm"
            placeholder={`Search in ${props.projectName}`}
            aria-label={`Search file contents in ${props.projectName}`}
          />
          <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
            <SearchOptionButton
              active={caseSensitive}
              label="Match case"
              onClick={() => setCaseSensitive((current) => !current)}
            >
              Aa
            </SearchOptionButton>
            <SearchOptionButton
              active={wholeWord}
              label="Match whole word"
              onClick={() => setWholeWord((current) => !current)}
            >
              <span className="underline decoration-2 underline-offset-2">ab</span>
            </SearchOptionButton>
            <SearchOptionButton
              active={useRegex}
              label="Use regular expression"
              onClick={() => setUseRegex((current) => !current)}
            >
              .*
            </SearchOptionButton>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">
            {isPending ? (
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-3.5 animate-spin" /> Searching…
              </span>
            ) : search.error ? (
              <span className="text-destructive">{search.error}</span>
            ) : search.data?.regexFallbackError ? (
              <span className="text-destructive">Invalid regular expression</span>
            ) : debouncedQuery.length === 0 ? (
              `Search every file in ${props.projectName}`
            ) : (
              `${matches.length.toLocaleString()}${search.data?.truncated ? "+" : ""} results in ${fileCount.toLocaleString()} files`
            )}
          </div>

          {matches.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {debouncedQuery.length > 0 && !isPending && !search.error
                ? "No results found."
                : "Type to search across your project."}
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1" scrollFade>
              <div className="py-2">
                {groups.map((group) => {
                  const path = splitPath(group.path);
                  return (
                    <section className="pb-2" key={group.path}>
                      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 bg-popover/95 px-3 text-xs backdrop-blur-sm">
                        <PierreEntryIcon
                          pathValue={group.path}
                          kind="file"
                          theme={resolvedTheme}
                          className="size-3.5"
                        />
                        <span className="font-medium text-foreground">{path.name}</span>
                        {path.directory ? (
                          <span className="min-w-0 truncate text-muted-foreground">
                            {path.directory}
                          </span>
                        ) : null}
                        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 tabular-nums text-[10px] text-muted-foreground">
                          {group.matches.length}
                        </span>
                      </div>
                      {group.matches.map((match) => (
                        <button
                          type="button"
                          key={`${match.path}:${match.lineNumber}:${match.resultIndex}`}
                          data-project-search-result={match.resultIndex}
                          className={cn(
                            "flex h-7 w-full min-w-0 items-center gap-3 px-3 text-left font-mono text-xs hover:bg-accent/60",
                            match.resultIndex === selectedIndex &&
                              "bg-accent text-accent-foreground",
                          )}
                          onMouseEnter={() => setSelectedIndex(match.resultIndex)}
                          onClick={() => openMatch(match)}
                        >
                          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/70">
                            {match.lineNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate whitespace-pre">
                            <SearchSyntaxErrorBoundary fallback={highlightedLine(match)}>
                              <Suspense fallback={highlightedLine(match)}>
                                <SyntaxHighlightedLine
                                  match={match}
                                  language={getFiletypeFromFileName(group.path)}
                                  themeName={themeName}
                                />
                              </Suspense>
                            </SearchSyntaxErrorBoundary>
                          </span>
                        </button>
                      ))}
                    </section>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
        <div className="flex h-9 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
          <span>↑↓ Navigate</span>
          <span>↵ Open file</span>
          <span>esc Close</span>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
