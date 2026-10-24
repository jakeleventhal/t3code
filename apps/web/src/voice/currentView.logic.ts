import type { EnvironmentId, PreviewSessionSnapshot, ProjectBotRole } from "@t3tools/contracts";

import { BOTS_HOME_PATH, isSettingsPath } from "../components/bots/botRoom.logic";
import type { PreviewMiniPlayerSource } from "../previewMiniPlayerStore";
import type { RightPanelSurface } from "../rightPanelStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  boundedTitle,
  redactViewUrl,
  type CurrentViewBrowserStatus,
  type CurrentViewDetail,
  type CurrentViewPage,
  type CurrentViewSnapshot,
} from "./currentView.shared";

export const PULL_REQUESTS_PATH = "/pull-requests";

export interface WebCurrentViewInput {
  readonly device: "web" | "desktop";
  /** The committed pathname, so it always names the same route as `target`. */
  readonly pathname: string;
  readonly target: ThreadRouteTarget | null;
  readonly draftEnvironmentId: EnvironmentId | null;
  readonly threadTitle: string | null;
  readonly project: {
    readonly title: string;
    readonly botRole?: ProjectBotRole | null | undefined;
  } | null;
  /** The open side-panel surface for the routed thread, or the pull request list's panel. */
  readonly panel: RightPanelSurface | null;
  /** This client's preview session for the panel's browser tab, when one is listed. */
  readonly browserSession: PreviewSessionSnapshot | null;
  /**
   * The routed thread's floating preview, when this client may render it, with this client's
   * session for its browser tab.
   */
  readonly floating: {
    readonly source: PreviewMiniPlayerSource;
    readonly browserSession: PreviewSessionSnapshot | null;
  } | null;
}

function resolvePage(input: WebCurrentViewInput): CurrentViewPage {
  const { target, pathname, project } = input;
  if (target?.kind === "server") {
    return {
      kind: "thread",
      environmentId: target.threadRef.environmentId,
      threadId: target.threadRef.threadId,
      room: project === null ? null : project.botRole != null ? "bots" : "code",
      title: boundedTitle(input.threadTitle),
      projectTitle: boundedTitle(project?.title),
    };
  }
  if (target?.kind === "draft") {
    return { kind: "new-thread", environmentId: input.draftEnvironmentId };
  }
  if (pathname === "/") return { kind: "home", room: "code" };
  if (pathname === BOTS_HOME_PATH) return { kind: "home", room: "bots" };
  if (pathname === PULL_REQUESTS_PATH) return { kind: "pull-requests" };
  if (isSettingsPath(pathname)) return { kind: "settings" };
  return { kind: "other" };
}

function browserStatus(session: PreviewSessionSnapshot): CurrentViewBrowserStatus {
  switch (session.navStatus._tag) {
    case "Idle":
      return "blank";
    case "Loading":
      return "loading";
    case "Success":
      return "loaded";
    case "LoadFailed":
      return "failed";
  }
}

function resolveBrowser(
  tabId: string | null,
  session: PreviewSessionSnapshot | null,
  device: WebCurrentViewInput["device"],
): Extract<CurrentViewDetail, { kind: "browser" }> {
  if (tabId === null) return { kind: "browser", tabId, url: null, title: null, status: "blank" };
  // Only the desktop app hosts desktop-runtime tabs; elsewhere the panel cannot show that page.
  const shown =
    session !== null &&
    session.tabId === tabId &&
    (session.runtime === "server" || device === "desktop");
  if (!shown) return { kind: "browser", tabId, url: null, title: null, status: null };
  const nav = session.navStatus;
  return {
    kind: "browser",
    tabId,
    url: nav._tag === "Idle" ? null : redactViewUrl(nav.url),
    title: nav._tag === "Idle" ? null : boundedTitle(nav.title),
    status: browserStatus(session),
  };
}

function resolveDetail(input: WebCurrentViewInput): CurrentViewDetail | null {
  const { panel } = input;
  switch (panel?.kind) {
    case undefined:
    case "pull-requests":
      return null;
    case "diff":
      return { kind: "diff" };
    case "pull-request":
      return {
        kind: "pull-request",
        repository: panel.repository,
        number: panel.number,
        section: panel.detailTab ?? null,
      };
    case "preview":
      return resolveBrowser(panel.resourceId, input.browserSession, input.device);
    case "file":
      return { kind: "file", path: panel.attachment ? null : panel.relativePath };
    case "files":
      return { kind: "files" };
    case "terminal":
      return { kind: "terminal" };
    case "device":
      return { kind: "device" };
  }
}

function resolveFloating(input: WebCurrentViewInput): CurrentViewDetail | null {
  const { floating } = input;
  if (floating === null) return null;
  if (floating.source.kind === "device") return { kind: "device" };
  // The floating player renders nothing for a tab this client cannot show.
  const browser = resolveBrowser(floating.source.tabId, floating.browserSession, input.device);
  return browser.status === null ? null : browser;
}

/**
 * The docked panel stays the subject, except that a floating browser page outranks a docked
 * surface with no page this client shows: the page is what a request can read.
 */
function resolveThreadDetail(input: WebCurrentViewInput): CurrentViewDetail | null {
  const docked = resolveDetail(input);
  if (docked?.kind === "browser" && docked.status !== null) return docked;
  const floating = resolveFloating(input);
  return floating?.kind === "browser" ? floating : (docked ?? floating);
}

export function resolveWebCurrentView(input: WebCurrentViewInput): CurrentViewSnapshot {
  const page = resolvePage(input);
  // Panels and floating previews belong to the page they opened over; nothing else carries one.
  const detail =
    page.kind === "thread"
      ? resolveThreadDetail(input)
      : page.kind === "pull-requests"
        ? resolveDetail(input)
        : null;
  return { device: input.device, page, detail };
}
