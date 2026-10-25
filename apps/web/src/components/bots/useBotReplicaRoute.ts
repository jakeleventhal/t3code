import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useBotProjects } from "./useBotRoom";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentConnectionSummaries } from "../../state/environments";
import { useComposerDraftStore } from "../../composerDraftStore";
import { buildThreadRouteParams } from "../../threadRoutes";

/** Only unsent plain text follows a ready copy. Dispatched commands retain their destination. */
export function useBotReplicaRoute(
  project: EnvironmentProject | null,
  source: ScopedThreadRef | null,
  unavailable: boolean,
) {
  const projects = useBotProjects();
  const environments = useEnvironmentConnectionSummaries();
  const selected = project?.botRole ? projects.find((copy) => copy.id === project.id) : null;
  const target =
    source &&
    selected &&
    selected.environmentId !== source.environmentId &&
    selected.botReplicaReady !== false &&
    environments.some(
      (entry) =>
        entry.environmentId === selected.environmentId && entry.connectionState === "connected",
    )
      ? scopeThreadRef(selected.environmentId, source.threadId)
      : null;
  const shell = useQuietThreadShell(target);
  const navigate = useNavigate();
  useEffect(() => {
    if (!unavailable || !source || !target || !shell || shell.deletedAt || shell.archivedAt) return;
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(source);
    const destination = store.getComposerDraft(target);
    if (destination?.prompt.trim()) return;
    if (
      draft &&
      (draft.images.length ||
        draft.files.length ||
        draft.persistedAttachments.length ||
        draft.terminalContexts.length ||
        draft.previewAnnotations.length ||
        draft.reviewComments.length ||
        draft.threadContexts.length)
    )
      return;
    store.moveComposerPromptAndImages(source, target);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target),
      replace: true,
    });
  }, [unavailable, source, target, shell, navigate]);
}
