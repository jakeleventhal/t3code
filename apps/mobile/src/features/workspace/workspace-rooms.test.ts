import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";

import {
  alignedRoomRoutes,
  planRoomAlignment,
  planRoomSwitch,
  routeThreadRef,
  type RoomRoute,
} from "./workspace-rooms";
import {
  initialWorkspaceTabsState,
  workspaceTabsReducer,
  type WorkspaceRoom,
  type WorkspaceRoute,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";

const require = NodeModule.createRequire(import.meta.url);
const nativePackage = require.resolve("@react-navigation/native/package.json");
const requireFromNative = NodeModule.createRequire(nativePackage);
const corePackage = requireFromNative.resolve("@react-navigation/core/package.json");
const requireFromCore = NodeModule.createRequire(corePackage);
const { CommonActions, StackActions, StackRouter } = requireFromCore(
  "@react-navigation/routers",
) as {
  readonly CommonActions: typeof import("@react-navigation/native").CommonActions;
  readonly StackActions: typeof import("@react-navigation/native").StackActions;
  readonly StackRouter: typeof import("@react-navigation/native").StackRouter;
};
const router = StackRouter({});
const options = {
  routeNames: [
    "Home",
    "Thread",
    "ThreadAttachment",
    "ThreadBrowserPreview",
    "ThreadReview",
    "PullRequest",
    "PullRequestFile",
    "PullRequestFiles",
    "AssistantQuick",
    "BotProfile",
    "SettingsSheet",
  ],
  routeParamList: {},
  routeGetIdList: {},
};
type State = ReturnType<typeof router.getInitialState>;

const codeThread = { environmentId: "env-a", threadId: "code-thread" };
const botThread = { environmentId: "env-a", threadId: "assistant-main" };
const pullRequest = {
  environmentId: "env-a",
  projectId: "project-a",
  repository: "acme/web",
  number: 2214,
  host: "github.com",
};

function apply(state: State, action: Parameters<typeof router.getStateForAction>[1]): State {
  const result = router.getStateForAction(state, action, options);
  if (!result) throw new Error(`Router rejected ${action.type}`);
  return router.getRehydratedState(result, options);
}

function push(state: State, name: string, params: object): State {
  return apply(state, StackActions.push(name, params));
}

function reset(state: State, routes: RoomRoute[]): State {
  return apply(state, CommonActions.reset({ ...state, index: routes.length - 1, routes }));
}

const names = (routes: readonly WorkspaceRoute[]) => routes.map((route) => route.name);
const keys = (routes: readonly WorkspaceRoute[]) => routes.map((route) => route.key);

/** One room switch as the provider runs it: plan, reset the stack, record the room. */
function switchRoom(
  state: { readonly navigation: State; readonly workspace: WorkspaceTabsState },
  to: WorkspaceRoom,
  target?: RoomRoute,
) {
  const plan = planRoomSwitch({
    routes: state.navigation.routes,
    from: state.workspace.room,
    to,
    parked: state.workspace.parkedRoutes[to],
    target,
  });
  if (plan === null) return state;
  return {
    navigation: reset(state.navigation, plan.routes),
    workspace: workspaceTabsReducer(state.workspace, {
      type: "room",
      room: to,
      leaving: plan.leaving,
    }),
  };
}

/** Owners as the navigator resolves them: the bot thread is in Bots, pull requests in Code. */
function ownerOf(route: WorkspaceRoute): WorkspaceRoom | null {
  if (route.name.startsWith("PullRequest")) return "code";
  const thread = routeThreadRef(route);
  if (thread?.threadId === botThread.threadId) return "bots";
  if (thread?.threadId === codeThread.threadId) return "code";
  return null;
}

describe("Code and Bots rooms", () => {
  it("opens the Assistant in Bots from a Code review and returns to that exact review", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", codeThread);
    navigation = push(navigation, "PullRequest", pullRequest);
    navigation = push(navigation, "AssistantQuick", { environmentId: "env-a" });
    const code = navigation.routes.slice(1, 3);
    let state = { navigation, workspace: initialWorkspaceTabsState() };

    state = switchRoom(state, "bots", { name: "Thread", params: botThread });
    // The quick sheet closes and Bots holds only the Assistant's chat.
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread"]);
    expect(state.navigation.routes[1]?.params).toEqual(botThread);
    expect(state.workspace.room).toBe("bots");
    expect(state.workspace.parkedRoutes.code).toEqual(code);
    // Back from the chat lands on the Bots list, not inside Code's history.
    expect(names(apply(state.navigation, StackActions.pop()).routes)).toEqual(["Home"]);

    state = switchRoom(state, "code");
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread", "PullRequest"]);
    expect(keys(state.navigation.routes.slice(1))).toEqual(keys(code));
    expect(state.navigation.routes[2]?.params).toEqual(pullRequest);
    expect(state.workspace.parkedRoutes).toEqual({ code: [], bots: [expect.anything()] });

    // And Bots still has its chat waiting.
    state = switchRoom(state, "bots");
    expect(state.navigation.routes[1]?.params).toEqual(botThread);
  });

  it("returns to the browser page the Assistant was opened from", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", codeThread);
    navigation = push(navigation, "ThreadBrowserPreview", { ...codeThread, tabId: "tab-2" });
    navigation = push(navigation, "AssistantQuick", { environmentId: "env-a" });
    const code = navigation.routes.slice(1, 3);
    let state = { navigation, workspace: initialWorkspaceTabsState() };

    state = switchRoom(state, "bots", { name: "Thread", params: botThread });
    // Only the chat is mounted in Bots: no second browser or thread stays behind.
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread"]);

    state = switchRoom(state, "code");
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread", "ThreadBrowserPreview"]);
    expect(keys(state.navigation.routes.slice(1))).toEqual(keys(code));
    expect(state.navigation.routes[2]?.params).toEqual({ ...codeThread, tabId: "tab-2" });
  });

  it("returns to a diff or review but closes pickers opened over it", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "PullRequest", pullRequest);
    navigation = push(navigation, "PullRequestFile", { ...pullRequest, path: "src/app.ts" });
    navigation = push(navigation, "PullRequestFiles", pullRequest);
    navigation = push(navigation, "AssistantQuick", { environmentId: "env-a" });
    let state = { navigation, workspace: initialWorkspaceTabsState() };
    state = switchRoom(state, "bots", { name: "Thread", params: botThread });
    state = switchRoom(state, "code");
    expect(names(state.navigation.routes)).toEqual(["Home", "PullRequest", "PullRequestFile"]);

    navigation = push(router.getInitialState(options), "Thread", codeThread);
    navigation = push(navigation, "ThreadReview", codeThread);
    navigation = push(navigation, "AssistantQuick", { environmentId: "env-a" });
    state = { navigation, workspace: initialWorkspaceTabsState() };
    state = switchRoom(state, "bots", { name: "Thread", params: botThread });
    state = switchRoom(state, "code");
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread", "ThreadReview"]);
  });

  it("closes a bot's profile on a room switch and parks only its chat", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", botThread);
    navigation = push(navigation, "BotProfile", { environmentId: "env-a", projectId: "bot-a" });
    const chat = navigation.routes.slice(1, 2);
    const workspace = workspaceTabsReducer(initialWorkspaceTabsState(), {
      type: "room",
      room: "bots",
    });
    let state = switchRoom({ navigation, workspace }, "code");
    expect(state.workspace.parkedRoutes.bots).toEqual(chat);

    state = switchRoom(state, "bots");
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread"]);
  });

  it("starts an empty room at its list and keeps the Home route", () => {
    const navigation = push(router.getInitialState(options), "Thread", codeThread);
    const state = switchRoom({ navigation, workspace: initialWorkspaceTabsState() }, "bots");
    expect(names(state.navigation.routes)).toEqual(["Home"]);
    expect(state.navigation.routes[0]?.key).toBe(navigation.routes[0]?.key);
  });

  it("does nothing when the room is already selected", () => {
    expect(planRoomSwitch({ routes: [], from: "code", to: "code", parked: [] })).toBeNull();
  });

  it("opens a target in the current room over a sheet, replacing its pages", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", botThread);
    navigation = push(navigation, "AssistantQuick", { environmentId: "env-a" });
    const workspace = workspaceTabsReducer(initialWorkspaceTabsState(), {
      type: "room",
      room: "bots",
    });
    const next = { name: "Thread", params: { environmentId: "env-a", threadId: "fitness" } };
    const state = switchRoom({ navigation, workspace }, "bots", next);
    expect(names(state.navigation.routes)).toEqual(["Home", "Thread"]);
    expect(state.navigation.routes[1]?.params).toEqual(next.params);
    expect(state.workspace).toBe(workspace);
  });
});

describe("pages opened in the other room", () => {
  it("moves a bot chat opened from a link to Bots, parking the Code page under it", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", codeThread);
    navigation = push(navigation, "Thread", botThread);
    navigation = push(navigation, "ThreadAttachment", { ...botThread, attachmentId: "a1" });
    navigation = push(navigation, "SettingsSheet", {});
    const detail = navigation.routes.slice(1, 4);

    const alignment = planRoomAlignment({ detail, room: "code", ownerOf });
    expect(alignment?.room).toBe("bots");
    expect(keys(alignment!.detail)).toEqual(keys(detail.slice(1)));
    expect(keys(alignment!.leaving)).toEqual(keys(detail.slice(0, 1)));

    // The chat keeps its route keys, so it never remounts, and the open sheet stays on top.
    const aligned = reset(navigation, alignedRoomRoutes(navigation.routes, alignment!.detail));
    expect(names(aligned.routes)).toEqual(["Home", "Thread", "ThreadAttachment", "SettingsSheet"]);
    expect(keys(aligned.routes.slice(1, 3))).toEqual(keys(detail.slice(1)));

    // Code remembers where it was.
    const workspace = workspaceTabsReducer(initialWorkspaceTabsState(), {
      type: "room",
      room: alignment!.room,
      leaving: alignment!.leaving,
    });
    const back = switchRoom({ navigation: aligned, workspace }, "code");
    expect(names(back.navigation.routes)).toEqual(["Home", "Thread"]);
    expect(back.navigation.routes[1]?.params).toEqual(codeThread);
  });

  it("keeps a full-screen modal over the moved pages when the layout split them off", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", codeThread);
    navigation = push(navigation, "Thread", botThread);
    navigation = push(navigation, "ThreadBrowserPreview", botThread);
    // iOS treats the browser as a modal, so its pages stop at the chat.
    const detail = navigation.routes.slice(1, 3);
    const alignment = planRoomAlignment({ detail, room: "code", ownerOf });
    const aligned = reset(navigation, alignedRoomRoutes(navigation.routes, alignment!.detail));
    expect(names(aligned.routes)).toEqual(["Home", "Thread", "ThreadBrowserPreview"]);
    expect(keys(aligned.routes.slice(1))).toEqual(keys(navigation.routes.slice(2)));
  });

  it("moves a pull request opened from a bot chat to Code", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", botThread);
    navigation = push(navigation, "PullRequest", pullRequest);
    const detail = navigation.routes.slice(1);
    const alignment = planRoomAlignment({ detail, room: "bots", ownerOf });
    expect(alignment?.room).toBe("code");
    expect(names(alignment!.detail)).toEqual(["PullRequest"]);
    expect(alignment!.leaving.map((route) => route.params)).toEqual([botThread]);
  });

  it("carries pages of unknown room with the page under them, and waits when none is known", () => {
    let navigation = router.getInitialState(options);
    navigation = push(navigation, "Thread", codeThread);
    navigation = push(navigation, "Thread", { environmentId: "env-a", threadId: "loading" });
    expect(
      planRoomAlignment({ detail: navigation.routes.slice(1), room: "bots", ownerOf }),
    ).toMatchObject({ room: "code", leaving: [] });
    expect(
      planRoomAlignment({ detail: navigation.routes.slice(1), room: "code", ownerOf }),
    ).toBeNull();
    expect(
      planRoomAlignment({ detail: navigation.routes.slice(2), room: "code", ownerOf: () => null }),
    ).toBeNull();
  });
});
