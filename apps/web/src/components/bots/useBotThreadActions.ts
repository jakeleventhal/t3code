import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";

import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { refreshArchivedThreadsForEnvironment } from "../../lib/archivedThreadsState";
import { readLocalApi } from "../../localApi";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { commitBotThreadRename } from "./botRoom.logic";
import { useBotActions } from "./useBotActions";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export interface BotThreadTarget {
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly archived: boolean;
}

/**
 * Rename, archive and reopen for a bot's secondary threads. Its main conversation is the bot
 * itself, so it is never offered here. Opening an archived thread only reads it; Reopen is the
 * one way back.
 */
export function useBotThreadActions(project: EnvironmentProject | null) {
  const routeThreadRef = useThreadRouteRef();
  const { archiveThread, unarchiveThread } = useThreadActions();
  const { openMainConversation, openThread } = useBotActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const confirmThreadArchive = useClientSettings((settings) => settings.confirmThreadArchive);

  const canOperate = () =>
    project !== null && readEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);

  /** Resolves false unless the title was saved or unchanged, so an inline editor can stay open. */
  const rename = async (target: BotThreadTarget, title: string): Promise<boolean> => {
    const accepted = await commitBotThreadRename({
      title,
      currentTitle: target.title,
      canOperate,
      save: (trimmed) =>
        updateThreadMetadata({
          environmentId: target.ref.environmentId,
          input: { threadId: target.ref.threadId, title: trimmed },
        }),
      report: (problem) => {
        if (problem.kind === "empty") {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        } else if (problem.kind === "forbidden") {
          toastManager.add({
            type: "warning",
            title: "This connection lacks permission to rename threads",
          });
        } else {
          failureToast("Failed to rename thread", problem.error);
        }
      },
    });
    if (accepted && target.archived) refreshArchivedThreadsForEnvironment(target.ref.environmentId);
    return accepted;
  };

  const archive = async (target: BotThreadTarget) => {
    if (project === null || target.ref.threadId === project.botMainThreadId || !canOperate()) {
      return;
    }
    const api = readLocalApi();
    if (confirmThreadArchive && api) {
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(`Archive thread "${target.title}"?`),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    // Leave for the main conversation first, so archiving never drops the user into a new draft.
    if (
      routeThreadRef !== null &&
      scopedThreadKey(routeThreadRef) === scopedThreadKey(target.ref)
    ) {
      if (!(await openMainConversation(project.environmentId, project))) return;
    }
    const result = await archiveThread(target.ref);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      failureToast("Failed to archive thread", squashAtomCommandFailure(result));
    }
  };

  const reopen = async (target: BotThreadTarget) => {
    if (!canOperate()) return;
    const result = await unarchiveThread(target.ref);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        failureToast("Failed to reopen thread", squashAtomCommandFailure(result));
      }
      return;
    }
    await openThread(target.ref);
  };

  /** The thread's context menu: Rename and Archive, or Reopen and Rename once archived. */
  const openMenu = async (
    target: BotThreadTarget,
    position: { x: number; y: number },
    onStartRename: () => void,
  ) => {
    const api = readLocalApi();
    if (!api || target.ref.threadId === project?.botMainThreadId || !canOperate()) return;
    const items = target.archived
      ? [
          { id: "reopen" as const, label: "Reopen thread", icon: "archive" as const },
          { id: "rename" as const, label: "Rename thread", icon: "pencil" as const },
        ]
      : [
          { id: "rename" as const, label: "Rename thread", icon: "pencil" as const },
          { id: "archive" as const, label: "Archive thread", icon: "archive" as const },
        ];
    const clicked = await settlePromise(() => api.contextMenu.show(items, position));
    if (clicked._tag === "Failure" || clicked.value === null) return;
    if (clicked.value === "rename") onStartRename();
    else if (clicked.value === "archive") await archive(target);
    else if (clicked.value === "reopen") await reopen(target);
  };

  return { rename, archive, reopen, openMenu, canOperate };
}
