import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { createEnvironmentViewReader } from "@t3tools/client-runtime/voice-call/environment-runtime";
import { createVoiceViewContext } from "@t3tools/client-runtime/voice-call/live-connector";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  useNavigation,
  type NavigationProp,
  type NavigationState,
  type ParamListBase,
} from "@react-navigation/native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useWorkspaceTabs } from "../features/workspace/WorkspaceTabsContext";
import { appAtomRegistry } from "../state/atom-registry";
import { botVoiceEnvironment } from "../state/bot-voice";
import { useProject, useQuietThreadShell } from "../state/entities";
import { useThreadServerBrowserTabs } from "../state/preview";
import { classifyMobileRoute, completeMobileCurrentView } from "./current-view.logic";
import {
  captureCurrentView,
  currentBrowserTarget,
  describeCurrentView,
  sameCurrentView,
  type CurrentViewSource,
} from "./current-view.shared";

// Stands in for a thread while the browser lookup is disabled; it is never read.
const NO_THREAD = scopeThreadRef(EnvironmentId.make("current-view"), ThreadId.make("none"));

function useRootStackState(): NavigationState | undefined {
  let root: NavigationProp<ParamListBase> = useNavigation();
  for (let parent = root.getParent(); parent !== undefined; parent = parent.getParent()) {
    root = parent;
  }
  return useSyncExternalStore(
    (onChange) => root.addListener("state", onChange),
    () => root.getState(),
  );
}

/**
 * What this device shows, read from its own navigation stack and the data its screens already
 * hold; never another client's panels or tabs. It reads no page contents and never polls.
 * Must render inside a screen of the root stack or a navigator nested in one.
 */
export function useCurrentView(): CurrentViewSource {
  const rootState = useRootStackState();
  const workspace = useWorkspaceTabs();
  const room = workspace?.state.room ?? null;
  const selectedTab = workspace?.state.selectedTab ?? null;
  const route =
    rootState === undefined
      ? null
      : classifyMobileRoute(
          rootState,
          room === null || selectedTab === null ? null : { room, selectedTab },
        );
  const page = route?.page;
  const threadRef =
    page?.kind === "thread" ? scopeThreadRef(page.environmentId, page.threadId) : null;
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const browserOpen = route?.detail?.kind === "browser" && threadRef !== null;
  const browser = useThreadServerBrowserTabs({ ...(threadRef ?? NO_THREAD), enabled: browserOpen });

  const next =
    route === null
      ? null
      : completeMobileCurrentView(route, {
          threadTitle: shell?.title ?? null,
          project,
          browserTabs: browserOpen && browser.loaded ? browser.tabs : null,
        });
  const [held, setHeld] = useState(next);
  let snapshot = held;
  if (next !== null && (held === null || !sameCurrentView(held, next))) {
    setHeld(next);
    snapshot = next;
  }

  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  const [capture] = useState(
    () => async () => (latest.current === null ? null : captureCurrentView(latest.current)),
  );
  return { snapshot, capture };
}

const readView = createEnvironmentViewReader(appAtomRegistry, botVoiceEnvironment);

/**
 * Reads this device's view for a typed message. Following the view is metadata only; the returned
 * read, called once per explicit send, is the only thing that reads a shown browser page.
 */
export function useCurrentViewReader() {
  const { snapshot } = useCurrentView();
  const [view] = useState(createVoiceViewContext);
  useEffect(() => {
    view.set(
      snapshot === null ? null : describeCurrentView(snapshot),
      currentBrowserTarget(snapshot),
    );
  }, [view, snapshot]);
  // Closing the panel abandons a page read still in flight. The send it belongs to outlives the
  // panel and goes out without the screen rather than failing.
  const [pending] = useState(() => new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    },
    [pending],
  );
  const [read] = useState(() => () => {
    const controller = new AbortController();
    pending.add(controller);
    return readView(view, controller.signal)
      .catch(() => null)
      .finally(() => pending.delete(controller));
  });
  return read;
}
