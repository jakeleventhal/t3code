import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveWebCurrentView, type WebCurrentViewInput } from "./currentView.logic";
import {
  captureCurrentView,
  currentBrowserTarget,
  describeCurrentView,
  redactViewUrl,
  sameCurrentView,
} from "./currentView.shared";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");
const threadTarget = {
  kind: "server",
  threadRef: scopeThreadRef(environmentId, threadId),
} as const;

function input(overrides: Partial<WebCurrentViewInput> = {}): WebCurrentViewInput {
  return {
    device: "web",
    pathname: "/env-1/thread-1",
    target: threadTarget,
    draftEnvironmentId: null,
    threadTitle: "Fix login",
    project: { title: "acme", botRole: null },
    panel: null,
    browserSession: null,
    floating: null,
    ...overrides,
  };
}

function session(overrides: Partial<PreviewSessionSnapshot> = {}): PreviewSessionSnapshot {
  return {
    threadId,
    tabId: "tab-1",
    navStatus: { _tag: "Success", url: "https://acme.test/login?code=secret#t", title: "Sign in" },
    canGoBack: false,
    canGoForward: false,
    runtime: "server",
    updatedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

const browserPanel = { id: "browser:tab-1", kind: "preview", resourceId: "tab-1" } as const;

describe("resolveWebCurrentView", () => {
  it("names a thread's room from its project, and admits not knowing before it loads", () => {
    expect(resolveWebCurrentView(input()).page).toMatchObject({ kind: "thread", room: "code" });
    expect(
      resolveWebCurrentView(input({ project: { title: "Assistant", botRole: "assistant" } })).page,
    ).toMatchObject({ kind: "thread", room: "bots", projectTitle: "Assistant" });
    expect(resolveWebCurrentView(input({ project: null, threadTitle: null })).page).toMatchObject({
      kind: "thread",
      environmentId,
      threadId,
      room: null,
      title: null,
    });
  });

  it("maps routes without a thread to their page", () => {
    const page = (pathname: string) =>
      resolveWebCurrentView(input({ pathname, target: null, panel: browserPanel })).page;
    expect(page("/")).toEqual({ kind: "home", room: "code" });
    expect(page("/bots")).toEqual({ kind: "home", room: "bots" });
    expect(page("/settings/voice")).toEqual({ kind: "settings", section: "voice" });
    expect(page("/usage")).toEqual({ kind: "other" });
    expect(
      resolveWebCurrentView(
        input({
          target: { kind: "draft", draftId: "draft-1" as never },
          draftEnvironmentId: environmentId,
        }),
      ).page,
    ).toEqual({ kind: "new-thread", environmentId });
  });

  it("only reports a panel beside the page that owns one", () => {
    expect(
      resolveWebCurrentView(
        input({ pathname: "/bots", target: null, panel: { id: "diff", kind: "diff" } }),
      ).detail,
    ).toBeNull();
    const pullRequest = {
      id: "pull-request:x",
      kind: "pull-request",
      projectId: "project-1",
      repository: "acme/app",
      number: 42,
      detailTab: "code",
    } as const;
    expect(
      resolveWebCurrentView(input({ pathname: "/pull-requests", target: null, panel: pullRequest }))
        .detail,
    ).toEqual({ kind: "pull-request", repository: "acme/app", number: 42, section: "code" });
  });

  it("reports the selected browser tab's address and title without its query", () => {
    expect(
      resolveWebCurrentView(input({ panel: browserPanel, browserSession: session() })).detail,
    ).toEqual({
      kind: "browser",
      tabId: "tab-1",
      url: "https://acme.test/login?…",
      title: "Sign in",
      status: "loaded",
    });
  });

  it("does not claim a page this client cannot be showing", () => {
    const desktopTab = session({ runtime: "desktop" });
    const unknown = { kind: "browser", tabId: "tab-1", url: null, title: null, status: null };
    expect(
      resolveWebCurrentView(input({ panel: browserPanel, browserSession: desktopTab })).detail,
    ).toEqual(unknown);
    expect(
      resolveWebCurrentView(
        input({ device: "desktop", panel: browserPanel, browserSession: desktopTab }),
      ).detail,
    ).toMatchObject({ url: "https://acme.test/login?…" });
    expect(
      resolveWebCurrentView(
        input({ panel: browserPanel, browserSession: session({ tabId: "tab-2" }) }),
      ).detail,
    ).toEqual(unknown);
    expect(
      resolveWebCurrentView(
        input({ panel: { id: "browser:new", kind: "preview", resourceId: null } }),
      ).detail,
    ).toMatchObject({ tabId: null, status: "blank" });
  });
});

describe("floating previews", () => {
  const floatingBrowser = (overrides: Partial<PreviewSessionSnapshot> = {}) => ({
    source: { kind: "browser", tabId: "tab-2" } as const,
    browserSession: session({ tabId: "tab-2", ...overrides }),
  });
  const floatingDevice = {
    source: {
      kind: "device",
      hostId: "host-1",
      deviceId: "device-1",
      platform: "ios",
      name: "iPhone",
    },
    browserSession: null,
  } as const;
  const view = (overrides: Partial<WebCurrentViewInput>) => resolveWebCurrentView(input(overrides));

  it("reports a floating browser page over the chat, and offers it to a request", () => {
    const result = view({ floating: floatingBrowser() });
    expect(result.detail).toMatchObject({ kind: "browser", tabId: "tab-2", status: "loaded" });
    expect(currentBrowserTarget(result)).toEqual({ environmentId, threadId, tabId: "tab-2" });
  });

  it("keeps a docked page the subject, but lets a floating page outrank a panel without one", () => {
    expect(
      view({ panel: browserPanel, browserSession: session(), floating: floatingBrowser() }).detail,
    ).toMatchObject({ tabId: "tab-1" });
    expect(
      view({ panel: { id: "diff", kind: "diff" }, floating: floatingBrowser() }).detail,
    ).toMatchObject({
      tabId: "tab-2",
    });
    // A docked desktop tab the web client cannot show gives way to the page it does show.
    expect(
      view({
        panel: browserPanel,
        browserSession: session({ runtime: "desktop" }),
        floating: floatingBrowser(),
      }).detail,
    ).toMatchObject({ tabId: "tab-2" });
    expect(view({ panel: { id: "diff", kind: "diff" }, floating: floatingDevice }).detail).toEqual({
      kind: "diff",
    });
    expect(view({ floating: floatingDevice }).detail).toEqual({ kind: "device" });
  });

  it("never claims a floating tab this client cannot show", () => {
    expect(view({ floating: floatingBrowser({ runtime: "desktop" }) }).detail).toBeNull();
    expect(
      view({ device: "desktop", floating: floatingBrowser({ runtime: "desktop" }) }).detail,
    ).toMatchObject({ tabId: "tab-2", status: "loaded" });
    expect(
      view({ floating: { source: floatingBrowser().source, browserSession: null } }).detail,
    ).toBeNull();
    expect(
      view({
        panel: { id: "diff", kind: "diff" },
        floating: floatingBrowser({ runtime: "desktop" }),
      }).detail,
    ).toEqual({ kind: "diff" });
  });

  it("falls back to the docked panel once the floating player closes", () => {
    const open = view({ panel: { id: "files", kind: "files" }, floating: floatingBrowser() });
    const closed = view({ panel: { id: "files", kind: "files" }, floating: null });
    expect(open.detail).toMatchObject({ kind: "browser" });
    expect(closed.detail).toEqual({ kind: "files" });
    expect(sameCurrentView(open, closed)).toBe(false);
  });

  it("only belongs to a thread page", () => {
    expect(
      view({ pathname: "/pull-requests", target: null, floating: floatingBrowser() }).detail,
    ).toBeNull();
  });
});

describe("currentBrowserTarget", () => {
  const target = (overrides: Partial<WebCurrentViewInput>) =>
    currentBrowserTarget(resolveWebCurrentView(input({ panel: browserPanel, ...overrides })));

  it("offers a call the browser tab this client shows, even while it loads", () => {
    const expected = { environmentId, threadId, tabId: "tab-1" };
    expect(target({ browserSession: session() })).toEqual(expected);
    expect(
      target({
        browserSession: session({
          navStatus: { _tag: "Loading", url: "https://acme.test/", title: "" },
        }),
      }),
    ).toEqual(expected);
    expect(target({ device: "desktop", browserSession: session({ runtime: "desktop" }) })).toEqual(
      expected,
    );
  });

  it("never offers a tab this client cannot be showing", () => {
    expect(target({ browserSession: session({ runtime: "desktop" }) })).toBeNull();
    expect(target({ browserSession: session({ tabId: "tab-2" }) })).toBeNull();
    expect(target({ browserSession: null })).toBeNull();
    expect(target({ panel: { id: "browser:new", kind: "preview", resourceId: null } })).toBeNull();
    expect(
      target({ pathname: "/pull-requests", target: null, browserSession: session() }),
    ).toBeNull();
    expect(target({ panel: null, browserSession: session() })).toBeNull();
  });
});

describe("current view sharing", () => {
  it("strips credentials, queries, fragments, and non-web payloads from addresses", () => {
    expect(redactViewUrl("https://user:pw@acme.test/a/b?token=1#x")).toBe(
      "https://acme.test/a/b?…",
    );
    expect(redactViewUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
    expect(redactViewUrl("data:text/html;base64,AAAA")).toBe("data:");
    expect(redactViewUrl("not a url")).toBeNull();
  });

  it("treats equal contents as the same view so consumers see no spurious change", () => {
    const left = resolveWebCurrentView(input({ panel: browserPanel, browserSession: session() }));
    const right = resolveWebCurrentView(input({ panel: browserPanel, browserSession: session() }));
    expect(sameCurrentView(left, right)).toBe(true);
    expect(sameCurrentView(left, resolveWebCurrentView(input()))).toBe(false);
    expect(
      sameCurrentView(
        left,
        resolveWebCurrentView(
          input({ device: "desktop", panel: browserPanel, browserSession: session() }),
        ),
      ),
    ).toBe(false);
  });

  it("tells the model what it cannot see in a browser page", () => {
    const view = resolveWebCurrentView(input({ panel: browserPanel, browserSession: session() }));
    expect(describeCurrentView(view)).toBe(
      'On their web browser, the user is viewing the Code thread "Fix login" in "acme" ' +
        "(environment env-1, thread thread-1). Also open: the in-app browser at " +
        'https://acme.test/login?… "Sign in". Only its address and title are known; its page ' +
        "text has not been read.",
    );
    expect(captureCurrentView(view).browserPage).toMatchObject({ status: "unavailable" });
    expect(captureCurrentView(resolveWebCurrentView(input())).browserPage).toBeNull();
  });

  it("publishes changed thread facts and drops them when viewing Settings", () => {
    const view = { ...resolveWebCurrentView(input()), threadContext: "Linked PRs: 2 total." };
    const changed = { ...view, threadContext: "Linked PRs: 3 total." };
    expect(sameCurrentView(view, changed)).toBe(false);
    expect(sameCurrentView(view, { ...view })).toBe(true);
    expect(describeCurrentView(changed)).toContain("Linked PRs: 3 total.");
    const settings = {
      ...resolveWebCurrentView(input({ pathname: "/settings/bots", target: null })),
      threadContext: view.threadContext,
    };
    expect(describeCurrentView(settings)).not.toContain("Linked PRs");
  });
});
