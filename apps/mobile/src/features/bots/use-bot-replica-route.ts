import { useEffect } from "react";
import { CommonActions, useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { useBotProjects, useKnownBotEnvironments } from "./use-assistant";
import { useQuietThreadShell } from "../../state/entities";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { scopedThreadKey } from "../../lib/scopedEntities";

export function useBotReplicaRoute(
  project: EnvironmentProject | null,
  source: EnvironmentThreadShell | null,
  unavailable: boolean,
) {
  const projects = useBotProjects();
  const environments = useKnownBotEnvironments();
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
      ? scopeThreadRef(selected.environmentId, source.id)
      : null;
  const shell = useQuietThreadShell(target);
  const navigation = useNavigation();
  // oxlint-disable-next-line t3code/react-effect-budget -- Retarget the mounted native screen after its environment becomes unavailable.
  useEffect(() => {
    if (!unavailable || !source || !target || !shell || shell.deletedAt || shell.archivedAt) return;
    const from = scopedThreadKey(source.environmentId, source.id);
    const to = scopedThreadKey(target.environmentId, target.threadId);
    const draft = getComposerDraftSnapshot(from);
    const destination = getComposerDraftSnapshot(to);
    // Uploaded files and context remain attached to their originating draft.
    if (draft.attachments.length || draft.context || destination.text.trim()) return;
    if (draft.text) {
      setComposerDraftText(to, draft.text);
      setComposerDraftText(from, "");
    }
    // Keep the native screen mounted while the connection changes; replacing it can race
    // an in-progress navigation transition and leave an unresponsive blank screen.
    navigation.dispatch(
      CommonActions.setParams({
        environmentId: String(target.environmentId),
        threadId: String(target.threadId),
      }),
    );
  }, [unavailable, source, target, shell, navigation]);
}
