import {
  EnvironmentId,
  ThreadId,
  type PreviewSessionSnapshot,
  type ProjectBotRole,
} from "@t3tools/contracts";

import { latestBrowserTab } from "../features/browser/browserTabs";
import type { WorkspaceRoute } from "../features/workspace/workspace-tabs-state";
import type { WorkspaceRoom, WorkspaceTab } from "../features/workspace/workspace-tabs-state";
import {
  boundedTitle,
  redactViewUrl,
  type CurrentViewBrowserStatus,
  type CurrentViewDetail,
  type CurrentViewPage,
  type CurrentViewSnapshot,
} from "./current-view.shared";

/**
 * Covers part of the page and is about the Assistant itself, so the page under it stays the
 * subject. Other sheets are about the page they cover and are reported as that page.
 */
const SEE_THROUGH_ROUTES: ReadonlySet<string> = new Set(["AssistantQuick"]);

const PULL_REQUEST_ROUTES: ReadonlySet<string> = new Set([
  "PullRequest",
  "PullRequestDiscussion",
  "PullRequestFile",
  "PullRequestFiles",
  "PullRequestGuideStop",
  "PullRequestInlineComment",
  "PullRequestReview",
  "PullRequestReviewers",
]);

/** The page a route shows, before thread and tab data are filled in. */
export interface MobileRouteView {
  readonly page: CurrentViewPage;
  readonly detail: CurrentViewDetail | null;
  /** The browser route's remembered tab, which the screen shows when it is still listed. */
  readonly browserTabId?: string;
}

function stringParam(route: WorkspaceRoute, key: string): string | null {
  const value = (route.params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pathParam(route: WorkspaceRoute): string | null {
  const value = (route.params as Record<string, unknown> | undefined)?.path;
  if (typeof value === "string") return value || null;
  return Array.isArray(value) && value.every((part) => typeof part === "string")
    ? value.join("/") || null
    : null;
}

function threadDetail(route: WorkspaceRoute): MobileRouteView["detail"] {
  switch (route.name) {
    case "ThreadBrowserPreview":
      return { kind: "browser", tabId: null, url: null, title: null, status: null };
    case "ThreadReview":
    case "ThreadReviewComment":
      return { kind: "diff" };
    case "ThreadFiles":
      return { kind: "files" };
    case "ThreadFile":
      return { kind: "file", path: pathParam(route) };
    case "ThreadTerminal":
      return { kind: "terminal" };
    case "ThreadDevicePreview":
      return { kind: "device" };
    default:
      return null;
  }
}

function classifyRoute(
  route: WorkspaceRoute,
  workspace: { readonly room: WorkspaceRoom; readonly selectedTab: WorkspaceTab } | null,
): MobileRouteView {
  const environmentId = stringParam(route, "environmentId");
  const threadId = stringParam(route, "threadId");
  if (environmentId !== null && threadId !== null) {
    const tabId = route.name === "ThreadBrowserPreview" ? stringParam(route, "tabId") : null;
    return {
      page: {
        kind: "thread",
        environmentId: EnvironmentId.make(environmentId),
        threadId: ThreadId.make(threadId),
        room: null,
        title: null,
        projectTitle: null,
      },
      detail: threadDetail(route),
      ...(tabId === null ? {} : { browserTabId: tabId }),
    };
  }
  const repository = stringParam(route, "repository");
  const number = (route.params as Record<string, unknown> | undefined)?.number;
  if (
    PULL_REQUEST_ROUTES.has(route.name) &&
    environmentId !== null &&
    repository !== null &&
    typeof number === "number"
  ) {
    return {
      page: {
        kind: "pull-request",
        environmentId: EnvironmentId.make(environmentId),
        repository,
        number,
      },
      detail:
        route.name === "PullRequestFile"
          ? { kind: "file", path: pathParam(route) }
          : route.name === "PullRequestFiles"
            ? { kind: "files" }
            : null,
    };
  }
  switch (route.name) {
    case "Home":
      if (workspace === null) return { page: { kind: "home", room: null }, detail: null };
      return {
        page:
          workspace.room === "code" && workspace.selectedTab === "pullRequests"
            ? { kind: "pull-requests" }
            : { kind: "home", room: workspace.room },
        detail: null,
      };
    case "Thread": {
      // A thread route without a thread is a new thread's draft.
      const draft = (route.params as Record<string, unknown> | undefined)?.draft;
      const draftEnvironmentId =
        typeof draft === "object" &&
        draft !== null &&
        "environmentId" in draft &&
        typeof draft.environmentId === "string" &&
        draft.environmentId.length > 0
          ? EnvironmentId.make(draft.environmentId)
          : null;
      return { page: { kind: "new-thread", environmentId: draftEnvironmentId }, detail: null };
    }
    case "NewTaskProject":
    case "NewTaskEnvironment":
    case "NewTaskBranch":
      return { page: { kind: "new-thread", environmentId: null }, detail: null };
    case "SettingsSheet":
    case "SettingsLegal":
      return { page: { kind: "settings" }, detail: null };
    default:
      return { page: { kind: "other" }, detail: null };
  }
}

/** The view under the top route of the root stack, looking through the quick Assistant. */
export function classifyMobileRoute(
  state: { readonly routes: readonly WorkspaceRoute[]; readonly index: number },
  workspace: { readonly room: WorkspaceRoom; readonly selectedTab: WorkspaceTab } | null,
): MobileRouteView {
  for (let index = Math.min(state.index, state.routes.length - 1); index >= 0; index--) {
    const route = state.routes[index]!;
    if (!SEE_THROUGH_ROUTES.has(route.name)) return classifyRoute(route, workspace);
  }
  return { page: { kind: "other" }, detail: null };
}

function browserStatus(tab: PreviewSessionSnapshot): CurrentViewBrowserStatus {
  switch (tab.navStatus._tag) {
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

export function completeMobileCurrentView(
  view: MobileRouteView,
  data: {
    readonly threadTitle: string | null;
    readonly project: {
      readonly title: string;
      readonly botRole?: ProjectBotRole | null | undefined;
    } | null;
    /** The thread's server browser tabs, or null until they are listed. */
    readonly browserTabs: ReadonlyArray<PreviewSessionSnapshot> | null;
  },
): CurrentViewSnapshot {
  const page: CurrentViewPage =
    view.page.kind === "thread"
      ? {
          ...view.page,
          room: data.project === null ? null : data.project.botRole != null ? "bots" : "code",
          title: boundedTitle(data.threadTitle),
          projectTitle: boundedTitle(data.project?.title),
        }
      : view.page;
  if (view.detail?.kind !== "browser") return { device: "mobile", page, detail: view.detail };
  if (data.browserTabs === null) return { device: "mobile", page, detail: view.detail };
  // The same pick as the browser screen: the remembered tab while listed, else the latest.
  const tab =
    data.browserTabs.find((entry) => entry.tabId === view.browserTabId) ??
    latestBrowserTab(data.browserTabs);
  if (tab === null) {
    return {
      device: "mobile",
      page,
      detail: { kind: "browser", tabId: null, url: null, title: null, status: "blank" },
    };
  }
  const nav = tab.navStatus;
  return {
    device: "mobile",
    page,
    detail: {
      kind: "browser",
      tabId: tab.tabId,
      url: nav._tag === "Idle" ? null : redactViewUrl(nav.url),
      title: nav._tag === "Idle" ? null : boundedTitle(nav.title),
      status: browserStatus(tab),
    },
  };
}
