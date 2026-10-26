import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

// Kept identical to apps/mobile/src/voice/current-view.shared.ts so both clients describe a
// screen the same way to a voice session.

export type CurrentViewRoom = "code" | "bots";

/** The main page this device shows. */
export type CurrentViewPage =
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      /** Null until this client has loaded the thread and its project. */
      readonly room: CurrentViewRoom | null;
      readonly title: string | null;
      readonly projectTitle: string | null;
    }
  | { readonly kind: "new-thread"; readonly environmentId: EnvironmentId | null }
  | {
      readonly kind: "pull-request";
      readonly environmentId: EnvironmentId;
      readonly repository: string;
      readonly number: number;
    }
  | { readonly kind: "home"; readonly room: CurrentViewRoom | null }
  | { readonly kind: "pull-requests" }
  | { readonly kind: "settings"; readonly section?: string }
  | { readonly kind: "other" };

export type CurrentViewBrowserStatus = "blank" | "loading" | "loaded" | "failed";

/** What this device shows beside or over the page: a web side panel, a mobile screen. */
export type CurrentViewDetail =
  | { readonly kind: "diff" }
  | {
      readonly kind: "pull-request";
      readonly repository: string;
      readonly number: number;
      readonly section: string | null;
    }
  | {
      readonly kind: "browser";
      /** Null while the tab list has not loaded or the browser has no tab yet. */
      readonly tabId: string | null;
      /** Origin and path only; query strings and fragments can carry credentials. */
      readonly url: string | null;
      readonly title: string | null;
      /**
       * Null when this device cannot be showing the tab: its tabs are not listed yet, or the tab
       * runs in a browser only another client hosts. Never null for a tab this device shows.
       */
      readonly status: CurrentViewBrowserStatus | null;
    }
  | { readonly kind: "file"; readonly path: string | null }
  | { readonly kind: "files" }
  | { readonly kind: "terminal" }
  | { readonly kind: "device" };

export interface CurrentViewSnapshot {
  readonly device: "web" | "desktop" | "mobile";
  readonly page: CurrentViewPage;
  readonly detail: CurrentViewDetail | null;
  readonly threadContext?: string | null;
}

export interface CurrentViewCapture {
  readonly view: CurrentViewSnapshot;
  /**
   * What a page in the browser contains. No client API reads page text or elements yet, so this
   * says so rather than leaving a model to guess from the address.
   */
  readonly browserPage: { readonly status: "unavailable"; readonly reason: string } | null;
}

export interface CurrentViewSource {
  /**
   * Changes identity only when what the device shows changes. Null until the client has a
   * settled view to report.
   */
  readonly snapshot: CurrentViewSnapshot | null;
  /** The latest snapshot plus whatever detail an explicit request can honestly add. */
  readonly capture: () => Promise<CurrentViewCapture | null>;
}

/** A browser tab this device is showing, which a call may read only when asked to. */
export interface CurrentViewBrowserTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tabId: string;
}

/** Only a tab on screen here; a tab another client hosts is never this device's to offer. */
export function currentBrowserTarget(
  view: CurrentViewSnapshot | null,
): CurrentViewBrowserTarget | null {
  if (view?.page.kind !== "thread" || view.detail?.kind !== "browser") return null;
  const { tabId, status } = view.detail;
  if (tabId === null || status === null) return null;
  return { environmentId: view.page.environmentId, threadId: view.page.threadId, tabId };
}

const TITLE_LIMIT = 120;
const URL_LIMIT = 300;
const BROWSER_PAGE_UNAVAILABLE =
  "This client exposes only the tab's address and title, not the page's text or elements.";

function bounded(text: string, limit: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}

export function boundedTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const result = bounded(title, TITLE_LIMIT);
  return result.length === 0 ? null : result;
}

/** Keeps origin and path; drops credentials, query strings, fragments, and non-web payloads. */
export function redactViewUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === undefined) return null;
  if (scheme !== "http" && scheme !== "https" && scheme !== "file") return `${scheme}:`;
  const cut = trimmed.search(/[?#]/);
  const base = (cut < 0 ? trimmed : trimmed.slice(0, cut)).replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i,
    "$1",
  );
  return bounded(cut < 0 ? base : `${base}?…`, URL_LIMIT);
}

function sameRecord(left: object | null, right: object | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(
    ([key, value]) => key in right && (right as Record<string, unknown>)[key] === value,
  );
}

export function sameCurrentView(left: CurrentViewSnapshot, right: CurrentViewSnapshot): boolean {
  return (
    left.device === right.device &&
    left.threadContext === right.threadContext &&
    sameRecord(left.page, right.page) &&
    sameRecord(left.detail, right.detail)
  );
}

export function captureCurrentView(view: CurrentViewSnapshot): CurrentViewCapture {
  return {
    view,
    browserPage:
      view.detail?.kind === "browser"
        ? { status: "unavailable", reason: BROWSER_PAGE_UNAVAILABLE }
        : null,
  };
}

function quoted(text: string | null): string {
  return text === null ? "" : ` "${text}"`;
}

function describePage(page: CurrentViewPage): string {
  switch (page.kind) {
    case "thread": {
      const room =
        page.room === "bots" ? "bot conversation" : page.room === "code" ? "Code thread" : "thread";
      const project = page.projectTitle === null ? "" : ` in${quoted(page.projectTitle)}`;
      return `the ${room}${quoted(page.title)}${project} (environment ${page.environmentId}, thread ${page.threadId})`;
    }
    case "new-thread":
      return "a new, unsent thread";
    case "pull-request":
      return `pull request ${page.repository}#${page.number}`;
    case "home":
      return page.room === "bots" ? "the Bots home" : "the Code home";
    case "pull-requests":
      return "the pull request list";
    case "settings":
      return page.section ? `Settings: ${page.section}` : "Settings";
    case "other":
      return "a page without a specific subject";
  }
}

function describeDetail(detail: CurrentViewDetail): string {
  switch (detail.kind) {
    case "diff":
      return "the thread's code changes";
    case "pull-request":
      return `pull request ${detail.repository}#${detail.number}${detail.section ? ` (${detail.section})` : ""}`;
    case "browser": {
      if (detail.status === "blank") return "the in-app browser on an empty tab";
      const where = detail.url === null ? "" : ` at ${detail.url}`;
      const state =
        detail.status === "loading"
          ? ", still loading"
          : detail.status === "failed"
            ? ", which failed to load"
            : "";
      return `the in-app browser${where}${quoted(detail.title)}${state}. Only its address and title are known; its page text has not been read`;
    }
    case "file":
      return detail.path === null ? "a file" : `the file ${detail.path}`;
    case "files":
      return "the thread's file browser";
    case "terminal":
      return "a terminal";
    case "device":
      return "a device preview";
  }
}

/** A short, bounded account of the screen for a voice session's context. */
export function describeCurrentView(view: CurrentViewSnapshot): string {
  const where =
    view.device === "mobile"
      ? "mobile device"
      : view.device === "desktop"
        ? "desktop app"
        : "web browser";
  const page = `On their ${where}, the user is viewing ${describePage(view.page)}.`;
  const location =
    view.detail === null ? page : `${page} Also open: ${describeDetail(view.detail)}.`;
  return view.page.kind === "thread" && view.threadContext
    ? `${location}\n${view.threadContext}`
    : location;
}
