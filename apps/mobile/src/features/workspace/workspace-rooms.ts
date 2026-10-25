import { isSettingsRoute } from "../settings/settings-navigation";
import type { WorkspaceRoom, WorkspaceRoute } from "./workspace-tabs-state";

/** A page to open: a parked route keeps its key, a new one gets a key from the router. */
export type RoomRoute = Omit<WorkspaceRoute, "key"> & { readonly key?: string };

/**
 * Sheets and modals that cover the workspace rather than belong to a room's history. Android
 * shows Settings as a workspace page, but a room switch still leaves it like any overlay.
 */
export const WORKSPACE_OVERLAY_ROUTES: ReadonlySet<string> = new Set([
  "AssistantQuick",
  "NewBot",
  "BotProfile",
  "BotThreads",
  "PullRequestReview",
  "PullRequestInlineComment",
  "ConnectOnboarding",
  "Connections",
  "ConnectionsNew",
  "GitBranches",
  "GitCommit",
  "GitConfirm",
  "GitOverview",
  "NewTaskProject",
  "NewTaskFiles",
  "NewTaskFile",
  "NewTaskAttachment",
  "NewTaskThreadSettings",
  "AddProject",
  "AddProjectRepository",
  "AddProjectDestination",
  "AddProjectLocal",
  "AddProjectNew",
  "NewTaskEnvironment",
  "NewTaskBranch",
  "SettingsLegal",
  "SettingsSheet",
  "ThreadAgents",
  "ThreadBackgroundWork",
  "ThreadPullRequests",
  "ThreadQueue",
  "ThreadReviewComment",
  "ThreadDevicePreview",
  "ThreadBrowserPreview",
  "ThreadSettingsSheet",
]);

// The layout keeps an MCP app's and the file picker's own paths, but a room switch closes them
// like the other modals.
const ROOM_SWITCH_CLOSES: ReadonlySet<string> = new Set(["ThreadMcpApp", "PullRequestFiles"]);
// The browser is the thread's page shown full screen rather than a sheet over it. A room switch
// parks it with the thread, so returning to Code reopens the page being read.
const ROOM_SWITCH_PARKS: ReadonlySet<string> = new Set(["ThreadBrowserPreview"]);

function isRoomOverlay(route: WorkspaceRoute) {
  return (
    !ROOM_SWITCH_PARKS.has(route.name) &&
    (isSettingsRoute(route.name) ||
      WORKSPACE_OVERLAY_ROUTES.has(route.name) ||
      ROOM_SWITCH_CLOSES.has(route.name))
  );
}

/** The room's own pages: everything above Home and below the first sheet or modal. */
export function workspaceDetailRoutes(routes: readonly WorkspaceRoute[]): WorkspaceRoute[] {
  const firstOverlay = routes.findIndex(isRoomOverlay);
  return routes
    .slice(0, firstOverlay < 0 ? undefined : firstOverlay)
    .filter((route) => route.name !== "Home");
}

/**
 * Code and Bots share one navigation stack, so the stack only ever holds the current room's
 * pages. Leaving a room parks its pages; entering one brings back what it parked, or opens
 * `target` in it instead. Overlays close either way.
 */
export function planRoomSwitch(input: {
  readonly routes: readonly WorkspaceRoute[];
  readonly from: WorkspaceRoom;
  readonly to: WorkspaceRoom;
  readonly parked: readonly WorkspaceRoute[];
  readonly target?: RoomRoute | null;
}): { readonly routes: RoomRoute[]; readonly leaving: readonly WorkspaceRoute[] } | null {
  const target = input.target ?? null;
  if (input.from === input.to && target === null) return null;
  const home = input.routes.find((route) => route.name === "Home") ?? { name: "Home" };
  const detail = workspaceDetailRoutes(input.routes);
  const leaving = input.from === input.to ? [] : detail;
  const entering: readonly RoomRoute[] =
    target !== null ? [target] : input.from === input.to ? detail : input.parked;
  return { routes: [home, ...entering], leaving };
}

/**
 * Moves the aligned pages into the stack, leaving anything open above them in place. iOS splits
 * pages from modals by presentation, so this keeps what follows the pages rather than
 * re-deciding which routes are overlays.
 */
export function alignedRoomRoutes(
  routes: readonly WorkspaceRoute[],
  detail: readonly WorkspaceRoute[],
): RoomRoute[] {
  const keys = new Set(detail.map((route) => route.key));
  const lastPage = routes.findLastIndex((route) => keys.has(route.key));
  const home = routes.find((route) => route.name === "Home") ?? { name: "Home" };
  return [home, ...detail, ...(lastPage < 0 ? [] : routes.slice(lastPage + 1))];
}

/**
 * A page opened from search, a notification, or a link can belong to the other room. The top
 * page with a known owner decides; it moves to its room with the pages above it and the run of
 * its own pages below it. Everything under that is parked in the room it was opened from.
 * `ownerOf` returns null for a page whose room it cannot tell.
 */
export function planRoomAlignment(input: {
  readonly detail: readonly WorkspaceRoute[];
  readonly room: WorkspaceRoom;
  readonly ownerOf: (route: WorkspaceRoute) => WorkspaceRoom | null;
}): {
  readonly room: WorkspaceRoom;
  readonly detail: readonly WorkspaceRoute[];
  readonly leaving: readonly WorkspaceRoute[];
} | null {
  let index = input.detail.length - 1;
  while (index >= 0 && input.ownerOf(input.detail[index]!) === null) index--;
  if (index < 0) return null;
  const owner = input.ownerOf(input.detail[index]!)!;
  if (owner === input.room) return null;
  let start = index;
  while (start > 0 && input.ownerOf(input.detail[start - 1]!) === owner) start--;
  return {
    room: owner,
    detail: input.detail.slice(start),
    leaving: input.detail.slice(0, start),
  };
}

/** Thread pages carry the thread they show; a thread's project decides its room. */
export function routeThreadRef(
  route: WorkspaceRoute | undefined,
): { readonly environmentId: string; readonly threadId: string } | null {
  const params = route?.params;
  if (
    params === undefined ||
    params === null ||
    !("environmentId" in params) ||
    !("threadId" in params) ||
    typeof params.environmentId !== "string" ||
    typeof params.threadId !== "string"
  ) {
    return null;
  }
  return { environmentId: params.environmentId, threadId: params.threadId };
}

/** Pull request pages only exist in Code. */
export function isPullRequestRoute(route: WorkspaceRoute): boolean {
  return route.name.startsWith("PullRequest");
}
