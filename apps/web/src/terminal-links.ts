import { parseFileUrlHref, resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { isMacPlatform } from "./lib/utils";

import { extractTerminalLinks, isTerminalUrl, type TerminalLinkKind, type TerminalLinkMatch } from "@t3tools/shared/terminalLinks";

export { extractTerminalLinks, isTerminalUrl, type TerminalLinkKind, type TerminalLinkMatch };

export interface TerminalBufferLineLike {
  readonly isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

export interface WrappedTerminalLinkLineSegment {
  bufferLineNumber: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface WrappedTerminalLinkLine {
  text: string;
  segments: ReadonlyArray<WrappedTerminalLinkLineSegment>;
}

/**
 * Explicit OSC 8 targets may be `file://` URIs; everything else is a path relative to `cwd`.
 * `hostname` is the terminal's environment's, which producers such as GNU `ls` put in the URI.
 * A URI's path is the exact filename, so only its `#L12C3` hash is a position.
 */
export function resolveTerminalLinkTarget(text: string, cwd: string, hostname?: string): string {
  const fileUrl = /^file:\/\//iu.test(text) ? parseFileUrlHref(text, hostname) : null;
  if (!fileUrl) return resolvePathLinkTarget(text, cwd);
  // Keep URI identity until consumers decode the filename, separately from its position.
  const uri = new URL(text);
  if (!fileUrl.path.startsWith("\\")) uri.hostname = "";
  return uri.href;
}

export function collectWrappedTerminalLinkLine(
  bufferLineNumber: number,
  getLine: (bufferLineIndex: number) => TerminalBufferLineLike | null | undefined,
): WrappedTerminalLinkLine | null {
  const anchorLine = getLine(bufferLineNumber - 1);
  if (!anchorLine) return null;

  let startBufferLineNumber = bufferLineNumber;
  let startLine = anchorLine;

  while (startBufferLineNumber > 1 && startLine.isWrapped) {
    const previousLine = getLine(startBufferLineNumber - 2);
    if (!previousLine) return null;
    startBufferLineNumber -= 1;
    startLine = previousLine;
  }

  const segments: WrappedTerminalLinkLineSegment[] = [];
  let nextStartIndex = 0;
  let currentBufferLineNumber = startBufferLineNumber;

  while (true) {
    const currentLine = getLine(currentBufferLineNumber - 1);
    if (!currentLine) break;

    const nextLine = getLine(currentBufferLineNumber);
    const hasWrappedContinuation = nextLine?.isWrapped === true;
    const text = currentLine.translateToString(!hasWrappedContinuation);

    segments.push({
      bufferLineNumber: currentBufferLineNumber,
      text,
      startIndex: nextStartIndex,
      endIndex: nextStartIndex + text.length,
    });
    nextStartIndex += text.length;

    if (!hasWrappedContinuation) break;
    currentBufferLineNumber += 1;
  }

  return {
    text: segments.map((segment) => segment.text).join(""),
    segments,
  };
}

export function isTerminalLinkActivation(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey">,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  if (platform.length === 0) return false;
  return isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}
