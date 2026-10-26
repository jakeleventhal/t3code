export type TerminalLinkKind = "url" | "path";

export interface TerminalLinkMatch {
  kind: TerminalLinkKind;
  text: string;
  start: number;
  end: number;
}

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/giu;
// Bare paths start only at a segment boundary: hover detection runs this on
// every frame, so separator-free output must not be rescanned at every suffix.
const FILE_PATH_PATTERN =
  /(?:~[\\/]|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>]+|(?<![\p{L}\p{M}\p{N}._-])[\p{L}\p{M}\p{N}._-]+(?:[\\/][\p{L}\p{M}\p{N}._-]+)+(?::\d+){0,2}/gu;
const QUOTED_FILE_PATH_PATTERN =
  /(["'`])(?<path>(?:~[\\/]|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/]|\\\\|[\p{L}\p{M}\p{N}._ -]+[\\/])[^\r\n]*?|[\p{L}\p{M}\p{N}._ -]+\.[\p{L}\p{M}\p{N}_-]+(?::\d+){0,2})\1(?<position>(?::\d+){0,2})/gu;
const TRAILING_PUNCTUATION_PATTERN = /[.,;!?]+$/;
// Paths also drop a trailing colon: compilers end `file:line:col:` with one.
const TRAILING_PATH_PUNCTUATION_PATTERN = /[.,;:!?]+$/;
// A question mark is legal in filenames; only exclude query-bearing request targets.
const REQUEST_ROUTE_PATTERN =
  /(?:^|[\s"'`])(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE|proxying)\s+["'`]?(?:\/|[A-Za-z0-9_-]+\/)[^\s?]*\?\S*/g;

function trimClosingDelimiters(value: string, kind: TerminalLinkKind): string {
  let output = value.replace(
    kind === "path" ? TRAILING_PATH_PUNCTUATION_PATTERN : TRAILING_PUNCTUATION_PATTERN,
    "",
  );
  if (output.length === 0) return output;

  // Count once and trim the unmatched trailing run in one slice; re-counting per
  // character is quadratic on long delimiter runs in terminal output.
  const trimUnbalanced = (open: string, close: string) => {
    const opens = output.split(open).length - 1;
    const closes = output.split(close).length - 1;
    const excess = Math.max(0, closes - opens);
    if (excess === 0) return;

    let trailing = 0;
    while (trailing < output.length && output[output.length - 1 - trailing] === close) {
      trailing += 1;
    }
    output = output.slice(0, output.length - Math.min(excess, trailing));
  };

  trimUnbalanced("(", ")");
  trimUnbalanced("[", "]");
  trimUnbalanced("{", "}");
  return output;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function collectMatches(
  line: string,
  kind: TerminalLinkKind,
  pattern: RegExp,
  existing: TerminalLinkMatch[],
): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];
  pattern.lastIndex = 0;

  for (const rawMatch of line.matchAll(pattern)) {
    const quotedPath = rawMatch.groups?.path;
    const raw =
      quotedPath === undefined ? rawMatch[0] : quotedPath + (rawMatch.groups?.position ?? "");
    const start = rawMatch.index + (quotedPath === undefined ? 0 : 1);
    if (start < 0 || raw.length === 0) continue;

    const trimmed = quotedPath === undefined ? trimClosingDelimiters(raw, kind) : raw;
    if (trimmed.length === 0) continue;
    if (kind === "path" && isTerminalUrl(trimmed)) continue;

    const candidate: TerminalLinkMatch = {
      kind,
      text: trimmed,
      start,
      // A position outside quotes spans the closing quote in the terminal buffer.
      end: start + trimmed.length + (rawMatch.groups?.position ? 1 : 0),
    };

    const collides = [...existing, ...matches].some((other) => overlaps(candidate, other));
    if (collides) continue;

    matches.push(candidate);
  }

  return matches;
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

function isWindowsPathStyle(value: string): boolean {
  return isWindowsAbsolutePath(value) || /[A-Za-z]:\\/.test(value);
}

function joinPath(base: string, next: string, separator: "/" | "\\"): string {
  const cleanBase = base.replace(/[\\/]+$/, "");
  if (separator === "\\") {
    return `${cleanBase}\\${next.replaceAll("/", "\\")}`;
  }
  return `${cleanBase}/${next.replace(/^\/+/, "")}`;
}

function inferHomeFromCwd(cwd: string): string | undefined {
  const posixUser = cwd.match(/^\/Users\/([^/]+)/);
  if (posixUser?.[1]) {
    return `/Users/${posixUser[1]}`;
  }

  const posixHome = cwd.match(/^\/home\/([^/]+)/);
  if (posixHome?.[1]) {
    return `/home/${posixHome[1]}`;
  }

  const windowsUser = cwd.match(/^([A-Za-z]:\\Users\\[^\\]+)/);
  if (windowsUser?.[1]) {
    return windowsUser[1];
  }

  return undefined;
}

function splitPathAndPosition(value: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} {
  let path = value;
  let column: string | undefined;
  let line: string | undefined;

  const columnMatch = path.match(/:(\d+)$/);
  if (!columnMatch?.[1]) {
    return { path, line: undefined, column: undefined };
  }

  column = columnMatch[1];
  path = path.slice(0, -columnMatch[0].length);

  const lineMatch = path.match(/:(\d+)$/);
  if (lineMatch?.[1]) {
    line = lineMatch[1];
    path = path.slice(0, -lineMatch[0].length);
  } else {
    line = column;
    column = undefined;
  }

  return { path, line, column };
}

export function extractTerminalLinks(line: string): TerminalLinkMatch[] {
  const requestRoutes = Array.from(line.matchAll(REQUEST_ROUTE_PATTERN), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const urlMatches = collectMatches(line, "url", URL_PATTERN, []);
  const quotedMatches = collectMatches(line, "path", QUOTED_FILE_PATH_PATTERN, urlMatches);
  const pathMatches = collectMatches(line, "path", FILE_PATH_PATTERN, [
    ...urlMatches,
    ...quotedMatches,
  ]);
  return [...urlMatches, ...quotedMatches, ...pathMatches]
    .filter(
      (match) => match.kind === "url" || !requestRoutes.some((route) => overlaps(match, route)),
    )
    .sort((a, b) => a.start - b.start);
}

export function isTerminalUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

/** The link whose character span contains `index`, if any. */
export function terminalLinkAtIndex(line: string, index: number): TerminalLinkMatch | undefined {
  if (index < 0 || index >= line.length) return undefined;
  return extractTerminalLinks(line).find((match) => match.start <= index && index < match.end);
}

export function resolvePathLinkTarget(rawPath: string, cwd: string): string {
  const { path, line, column } = splitPathAndPosition(rawPath);

  let resolvedPath = path;
  if (path.startsWith("~/")) {
    const home = inferHomeFromCwd(cwd);
    if (home) {
      const separator: "/" | "\\" = isWindowsPathStyle(home) ? "\\" : "/";
      resolvedPath = joinPath(home, path.slice(2), separator);
    }
  } else if (!isAbsolutePath(path)) {
    const separator: "/" | "\\" = isWindowsPathStyle(cwd) ? "\\" : "/";
    resolvedPath = joinPath(cwd, path, separator);
  }

  if (!line || line === "0") return resolvedPath;
  return `${resolvedPath}:${line}${column && column !== "0" ? `:${column}` : ""}`;
}
