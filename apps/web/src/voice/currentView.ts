import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createEnvironmentViewReader } from "@t3tools/client-runtime/voice-call/environment-runtime";
import { createVoiceViewContext } from "@t3tools/client-runtime/voice-call/live-connector";
import { AuthPreviewOperateScope } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useCommittedLocation } from "../hooks/useCommittedLocation";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import {
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import { useThreadPreviewState } from "../previewStateStore";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { botVoiceEnvironment } from "../state/botVoice";
import { useProject, useQuietThreadShell, useThreadVoiceContext } from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { PULL_REQUESTS_PATH, resolveWebCurrentView } from "./currentView.logic";
import {
  captureCurrentView,
  currentBrowserTarget,
  describeCurrentView,
  sameCurrentView,
  type CurrentViewSource,
} from "./currentView.shared";

/** Read inside the router so floating Assistant panels retain the page underneath as context. */
export function useCurrentView(): CurrentViewSource {
  const committed = useCommittedLocation();
  const target = useThreadRouteTarget();
  const threadRef = target?.kind === "server" ? target.threadRef : null;
  const draftEnvironmentId = useComposerDraftStore((store) =>
    target?.kind === "draft"
      ? (store.getDraftSession(target.draftId)?.environmentId ?? null)
      : null,
  );
  const shell = useQuietThreadShell(threadRef);
  const threadContext = useThreadVoiceContext(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const panelRef = committed?.pathname === PULL_REQUESTS_PATH ? PULL_REQUESTS_PANEL_REF : threadRef;
  const panel = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, panelRef),
  );
  const browserTabId = panel?.kind === "preview" ? panel.resourceId : null;
  const miniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, threadRef),
  );
  // ChatView renders a floating browser only for someone allowed to operate previews.
  const canOperatePreview = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const floatingSource =
    miniPlayer !== null && (miniPlayer.source.kind === "device" || canOperatePreview)
      ? miniPlayer.source
      : null;
  const floatingTabId = floatingSource?.kind === "browser" ? floatingSource.tabId : null;
  const previewState = useThreadPreviewState(
    browserTabId === null && floatingTabId === null ? null : threadRef,
  );

  // Mid-navigation, route params still name the page on screen while the location has moved
  // on; publishing either pairing would describe a page that never existed, so hold the last.
  const next =
    committed === null
      ? null
      : resolveWebCurrentView({
          device: isElectron ? "desktop" : "web",
          pathname: committed.pathname,
          target,
          draftEnvironmentId,
          threadTitle: shell?.title ?? null,
          project,
          panel,
          browserSession:
            browserTabId === null ? null : (previewState.sessions[browserTabId] ?? null),
          floating:
            floatingSource === null
              ? null
              : {
                  source: floatingSource,
                  browserSession:
                    floatingTabId === null ? null : (previewState.sessions[floatingTabId] ?? null),
                },
        });
  const enriched = next === null ? null : { ...next, threadContext };
  const [held, setHeld] = useState(enriched);
  let snapshot = held;
  if (enriched !== null && (held === null || !sameCurrentView(held, enriched))) {
    setHeld(enriched);
    snapshot = enriched;
  }

  const latest = useRef(snapshot);
  // oxlint-disable-next-line t3code/react-effect-budget -- Expose only committed navigation context to asynchronous voice capture.
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  const [capture] = useState(
    () => async () => (latest.current === null ? null : captureCurrentView(latest.current)),
  );
  return { snapshot, capture };
}

const readView = createEnvironmentViewReader(appAtomRegistry, botVoiceEnvironment);

/** Read inside the router so floating Assistant panels retain the page underneath as context. */
export function useCurrentViewReader() {
  const { snapshot } = useCurrentView();
  const [view] = useState(createVoiceViewContext);
  // oxlint-disable-next-line t3code/react-effect-budget -- Publish committed navigation changes to the independent voice session.
  useEffect(() => {
    view.set(
      snapshot === null ? null : describeCurrentView(snapshot),
      currentBrowserTarget(snapshot),
    );
  }, [view, snapshot]);
  // Closing the panel abandons a page read still in flight. The send it belongs to outlives the
  // panel and goes out without the screen rather than failing.
  const [pending] = useState(() => new Set<AbortController>());
  // oxlint-disable-next-line t3code/react-effect-budget -- Abort outstanding page reads when the panel unmounts.
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
