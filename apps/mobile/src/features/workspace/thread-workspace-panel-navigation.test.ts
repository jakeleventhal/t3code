import * as NodeModule from "node:module";
import { expect, it } from "vite-plus/test";
import {
  closedThreadWorkspaceFileParams,
  threadWorkspacePanelAction,
  threadWorkspaceFileIsFullscreen,
} from "./thread-workspace-panel-navigation";
import { selectWorkspaceDetail, workspaceDetailRouter } from "./workspace-detail-selection";

const require = NodeModule.createRequire(import.meta.url);
const requireFromNative = NodeModule.createRequire(
  require.resolve("@react-navigation/native/package.json"),
);
const requireFromCore = NodeModule.createRequire(
  requireFromNative.resolve("@react-navigation/core/package.json"),
);
const { StackRouter } = requireFromCore("@react-navigation/routers") as {
  readonly StackRouter: typeof import("@react-navigation/native").StackRouter;
};
const base = StackRouter({});
const router = { ...base, ...workspaceDetailRouter(base) };
const options = {
  routeNames: ["Home", "Thread", "ThreadReview", "ThreadReviewFile", "ThreadFiles", "ThreadFile"],
  routeParamList: {},
  routeGetIdList: {},
};
type State = ReturnType<typeof base.getInitialState>;
type Action = Parameters<typeof base.getStateForAction>[1];
const thread = { environmentId: "env", threadId: "thread" };
function apply(state: State, action: Action) {
  const next = router.getStateForAction(state, action, options);
  if (!next) throw new Error(`Router rejected ${action.type}`);
  return base.getRehydratedState(next as State, options);
}
function selectThread(state: State) {
  return apply(
    state,
    selectWorkspaceDetail({ name: "Thread", params: thread }) as unknown as Action,
  );
}

it.each(["Thread", "ThreadReview", "ThreadReviewFile", "ThreadFiles", "ThreadFile"])(
  "repeated panel switches in %s keep the selected content and one workspace route",
  (name) => {
    let state = selectThread(base.getInitialState(options));
    const selection = {
      ...thread,
      inspector: { type: "thread", environmentId: "env", threadId: "preview" },
      path: ["README.md"],
      fileFullscreen: true,
      reviewSectionId: "working",
      reviewFilePath: "src/index.ts",
    };
    state = apply(state, { type: "NAVIGATE", payload: { name, params: selection } });
    const workspaceKey = state.routes.at(-1)!.key;
    for (const panel of ["branches", "workspace", "branches", "workspace", "branches"] as const) {
      state = apply(state, threadWorkspacePanelAction(state.routes.at(-1)!, thread, panel, "git"));
      expect(state.routes.map((route) => route.name)).toEqual(
        name === "Thread" ? ["Home", "Thread"] : ["Home", "Thread", name],
      );
      expect(state.routes.at(-1)).toMatchObject({
        key: workspaceKey,
        params: {
          ...selection,
          workspacePanel: panel,
          inspector: undefined,
          fileFullscreen: undefined,
        },
      });
    }
    state = apply(state, {
      type: "SET_PARAMS",
      source: workspaceKey,
      payload: { params: closedThreadWorkspaceFileParams },
    });
    expect(state.routes.at(-1)).toMatchObject({
      key: workspaceKey,
      params: { ...thread, workspacePanel: "branches", ...closedThreadWorkspaceFileParams },
    });
    expect(state.routes).toHaveLength(name === "Thread" ? 2 : 3);
    state = selectThread(state);
    expect(state.routes.map((route) => route.name)).toEqual(["Home", "Thread"]);
    expect(state.routes.at(-1)?.params).toEqual(thread);
  },
);

it("opens the remembered workspace pane for the active thread without reusing another thread's route", () => {
  const route = { name: "ThreadFile", key: "old-file", params: { ...thread, threadId: "another" } };
  expect(threadWorkspacePanelAction(route, thread, "branches", "files")).toEqual({
    type: "NAVIGATE",
    payload: { name: "ThreadFiles", params: { ...thread, workspacePanel: "branches" } },
  });
});

it("expands and restores the selected file without replacing its route or selection", () => {
  let state = selectThread(base.getInitialState(options));
  state = apply(state, {
    type: "NAVIGATE",
    payload: { name: "ThreadFile", params: { ...thread, path: ["src", "file.ts"], line: 40 } },
  });
  const key = state.routes.at(-1)!.key;
  for (const fileFullscreen of [true, undefined, true]) {
    state = apply(state, {
      type: "SET_PARAMS",
      source: key,
      payload: { params: { fileFullscreen } },
    });
    expect(state.routes.at(-1)).toMatchObject({
      key,
      params: { ...thread, path: ["src", "file.ts"], line: 40, fileFullscreen },
    });
    expect(threadWorkspaceFileIsFullscreen(state.routes.at(-1))).toBe(fileFullscreen === true);
    expect(state.routes).toHaveLength(3);
  }
  state = apply(state, {
    type: "SET_PARAMS",
    source: key,
    payload: { params: closedThreadWorkspaceFileParams },
  });
  expect(threadWorkspaceFileIsFullscreen(state.routes.at(-1))).toBe(false);
  expect(state.routes.at(-1)?.params).toMatchObject({
    ...thread,
    ...closedThreadWorkspaceFileParams,
  });
});

it.each([
  { name: "Thread", params: { fileFullscreen: true, path: ["README.md"] }, expected: true },
  {
    name: "ThreadFile",
    params: { fileFullscreen: true, path: ["src", "file.ts"] },
    expected: true,
  },
  {
    name: "ThreadReviewFile",
    params: { fileFullscreen: true, reviewSectionId: "working", reviewFilePath: "src/file.ts" },
    expected: true,
  },
  {
    name: "ThreadReview",
    params: { fileFullscreen: true, reviewSectionId: "working", reviewWorkingTreeScope: "staged" },
    expected: true,
  },
  { name: "ThreadFile", params: { fileFullscreen: true }, expected: false },
  { name: "ThreadFile", params: { fileFullscreen: true, path: [] }, expected: false },
  { name: "ThreadFile", params: { fileFullscreen: false, path: ["README.md"] }, expected: false },
  {
    name: "ThreadFile",
    params: { fileFullscreen: true, path: ["README.md"], workspacePanel: "branches" },
    expected: false,
  },
  { name: "PullRequest", params: { fileFullscreen: true, path: ["README.md"] }, expected: false },
])("only focuses a selected thread file or diff: $name $params", ({ expected, ...route }) => {
  expect(threadWorkspaceFileIsFullscreen(route)).toBe(expected);
});
