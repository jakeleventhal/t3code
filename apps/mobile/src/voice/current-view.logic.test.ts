import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkspaceRoute } from "../features/workspace/workspace-tabs-state";
import { classifyMobileRoute, completeMobileCurrentView } from "./current-view.logic";
import { currentBrowserTarget, describeCurrentView } from "./current-view.shared";

const thread = { environmentId: "env-1", threadId: "thread-1" };
const codeWorkspace = { room: "code", selectedTab: "threads" } as const;
let nextKey = 0;

function stack(...routes: Array<[name: string, params?: object]>) {
  const built = routes.map(
    ([name, params]) => ({ key: `${name}-${nextKey++}`, name, params }) as WorkspaceRoute,
  );
  return { routes: built, index: built.length - 1 };
}

function tab(tabId: string, updatedAt: string, url = `https://acme.test/${tabId}?t=1`) {
  return {
    threadId: "thread-1",
    tabId,
    navStatus: { _tag: "Success", url, title: `Tab ${tabId}` },
    canGoBack: false,
    canGoForward: false,
    runtime: "server",
    updatedAt,
  } satisfies PreviewSessionSnapshot;
}

const noData = { threadTitle: null, project: null, browserTabs: null };

describe("classifyMobileRoute", () => {
  it("reports a new thread's draft and its project picker as a new thread", () => {
    expect(
      classifyMobileRoute(
        stack(["Home"], ["Thread", { draft: { environmentId: "env-1", projectId: "p" } }]),
        codeWorkspace,
      ).page,
    ).toEqual({ kind: "new-thread", environmentId: "env-1" });
    expect(classifyMobileRoute(stack(["Home"], ["NewTaskProject"]), codeWorkspace).page).toEqual({
      kind: "new-thread",
      environmentId: null,
    });
  });

  it("reports the page under the quick Assistant, not the Assistant", () => {
    const view = classifyMobileRoute(
      stack(
        ["Home"],
        ["Thread", thread],
        ["ThreadBrowserPreview", { ...thread, tabId: "tab-2" }],
        ["AssistantQuick", { environmentId: "env-1" }],
      ),
      codeWorkspace,
    );
    expect(view.page).toMatchObject({
      kind: "thread",
      environmentId: "env-1",
      threadId: "thread-1",
    });
    expect(view.detail).toMatchObject({ kind: "browser" });
    expect(view.browserTabId).toBe("tab-2");
  });

  it("reports the top route, so a pushed screen replaces the one under it", () => {
    expect(
      classifyMobileRoute(
        stack(["Home"], ["Thread", thread], ["ThreadReview", thread]),
        codeWorkspace,
      ).detail,
    ).toEqual({ kind: "diff" });
    expect(
      classifyMobileRoute(
        stack(["Home"], ["Thread", thread], ["ThreadFile", { ...thread, path: ["src", "a.ts"] }]),
        codeWorkspace,
      ).detail,
    ).toEqual({ kind: "file", path: "src/a.ts" });
    // A sheet about the thread is still the thread.
    expect(
      classifyMobileRoute(
        stack(["Home"], ["Thread", thread], ["GitOverview", thread]),
        codeWorkspace,
      ),
    ).toMatchObject({ page: { kind: "thread" }, detail: null });
  });

  it("reads pull requests from their own routes", () => {
    const params = { environmentId: "env-1", projectId: "p", repository: "acme/app", number: 7 };
    expect(classifyMobileRoute(stack(["Home"], ["PullRequest", params]), codeWorkspace)).toEqual({
      page: { kind: "pull-request", environmentId: "env-1", repository: "acme/app", number: 7 },
      detail: null,
    });
    expect(
      classifyMobileRoute(
        stack(["Home"], ["PullRequest", params], ["PullRequestFile", { ...params, path: "a.ts" }]),
        codeWorkspace,
      ).detail,
    ).toEqual({ kind: "file", path: "a.ts" });
  });

  it("reports the active nested Settings page through the Assistant sheet", () => {
    const state = {
      index: 1,
      routes: [
        {
          key: "settings",
          name: "SettingsSheet",
          state: {
            index: 0,
            routes: [
              {
                key: "content",
                name: "SettingsContent",
                state: {
                  index: 1,
                  routes: [
                    { key: "home", name: "Settings" },
                    { key: "voice", name: "SettingsVoiceDefault" },
                  ],
                },
              },
            ],
          },
        },
        { key: "assistant", name: "AssistantQuick" },
      ],
    };
    expect(classifyMobileRoute(state, codeWorkspace).page).toEqual({
      kind: "settings",
      section: "Bots / Default voice",
    });
  });

  it("names Home by the selected room and tab", () => {
    const home = stack(["Home"]);
    expect(classifyMobileRoute(home, codeWorkspace).page).toEqual({ kind: "home", room: "code" });
    expect(classifyMobileRoute(home, { room: "bots", selectedTab: "threads" }).page).toEqual({
      kind: "home",
      room: "bots",
    });
    expect(classifyMobileRoute(home, { room: "code", selectedTab: "pullRequests" }).page).toEqual({
      kind: "pull-requests",
    });
    expect(classifyMobileRoute(home, null).page).toEqual({ kind: "home", room: null });
    expect(classifyMobileRoute(stack(["Home"], ["SettingsSheet"]), codeWorkspace).page).toEqual({
      kind: "settings",
    });
  });
});

describe("completeMobileCurrentView", () => {
  const browserRoute = (tabId?: string) =>
    classifyMobileRoute(
      stack(
        ["Home"],
        ["Thread", thread],
        ["ThreadBrowserPreview", tabId === undefined ? thread : { ...thread, tabId }],
      ),
      codeWorkspace,
    );
  const tabs = [tab("tab-1", "2026-10-24T00:00:01Z"), tab("tab-2", "2026-10-24T00:00:02Z")];

  it("picks the tab the browser screen shows: the remembered one, else the latest", () => {
    const remembered = completeMobileCurrentView(browserRoute("tab-1"), {
      ...noData,
      browserTabs: tabs,
    });
    expect(remembered.detail).toEqual({
      kind: "browser",
      tabId: "tab-1",
      url: "https://acme.test/tab-1?…",
      title: "Tab tab-1",
      status: "loaded",
    });
    expect(
      completeMobileCurrentView(browserRoute("closed"), { ...noData, browserTabs: tabs }).detail,
    ).toMatchObject({ tabId: "tab-2" });
    expect(
      completeMobileCurrentView(browserRoute(), { ...noData, browserTabs: tabs }).detail,
    ).toMatchObject({
      tabId: "tab-2",
    });
  });

  it("does not guess a tab before the list loads", () => {
    expect(completeMobileCurrentView(browserRoute("tab-1"), noData).detail).toEqual({
      kind: "browser",
      tabId: null,
      url: null,
      title: null,
      status: null,
    });
  });

  it("offers a call only the browser tab on screen", () => {
    expect(
      currentBrowserTarget(
        completeMobileCurrentView(browserRoute("tab-1"), { ...noData, browserTabs: tabs }),
      ),
    ).toEqual({ environmentId: "env-1", threadId: "thread-1", tabId: "tab-1" });
    expect(currentBrowserTarget(completeMobileCurrentView(browserRoute("tab-1"), noData))).toBe(
      null,
    );
    expect(
      currentBrowserTarget(
        completeMobileCurrentView(browserRoute(), { ...noData, browserTabs: [] }),
      ),
    ).toBeNull();
    expect(
      currentBrowserTarget(
        completeMobileCurrentView(
          classifyMobileRoute(stack(["Home"], ["Thread", thread]), codeWorkspace),
          { ...noData, browserTabs: tabs },
        ),
      ),
    ).toBeNull();
  });

  it("fills a thread's room and title from its project once loaded", () => {
    const view = completeMobileCurrentView(
      classifyMobileRoute(stack(["Home"], ["Thread", thread]), null),
      {
        threadTitle: "Plan the week",
        project: { title: "Assistant", botRole: "assistant" },
        browserTabs: null,
      },
    );
    expect(view.page).toMatchObject({
      room: "bots",
      title: "Plan the week",
      projectTitle: "Assistant",
    });
    expect(describeCurrentView(view)).toBe(
      'On their mobile device, the user is viewing the bot conversation "Plan the week" in ' +
        '"Assistant" (environment env-1, thread thread-1).',
    );
  });
});
