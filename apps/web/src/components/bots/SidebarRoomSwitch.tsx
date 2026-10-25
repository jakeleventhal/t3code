import { hasUnseenCompletion } from "../Sidebar.logic";
import { environmentAssistant } from "@t3tools/client-runtime/assistant-environment";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CodeIcon, LayoutGridIcon } from "lucide-react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readProjects, readThreadShell, useProjects, useThreadShells } from "../../state/entities";
import { environmentShell } from "../../state/shell";
import { buildThreadRouteParams, isThreadRouteSnapshotAuthoritative } from "../../threadRoutes";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  BOTS_HOME_PATH,
  botProjectKeys,
  resolveBotsRoomEntry,
  type AppRoom,
} from "./botRoom.logic";
import { useBotRoomStore } from "./botRoomStore";
import { useDesignatedAssistantEnvironmentId } from "./useBotRoom";

function NeedsYouDot({ unread = false }: { unread?: boolean }) {
  return (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
      <span className="sr-only">{unread ? ", unread reply" : ", needs you"}</span>
    </>
  );
}

/**
 * Opens the Bots room where it was last left, or on the designated Assistant when it exists. A
 * saved spot that was deleted is forgotten rather than followed into the missing-thread redirect.
 */
export function useEnterBotsRoom() {
  const navigate = useNavigate();
  return (assistantEnvironmentId: EnvironmentId | null) => {
    const store = useBotRoomStore.getState();
    const savedEnvironmentId = store.environmentId;
    const saved =
      savedEnvironmentId === null ? undefined : store.botLocationByEnvironment[savedEnvironmentId];
    const mainThreadId =
      environmentAssistant(readProjects(), assistantEnvironmentId)?.botMainThreadId ?? null;
    const mainThreadRef =
      assistantEnvironmentId !== null && mainThreadId !== null
        ? scopeThreadRef(assistantEnvironmentId, mainThreadId)
        : null;
    const { entry, pruneSaved } = resolveBotsRoomEntry({
      saved:
        saved === undefined
          ? null
          : saved.target.kind === "draft"
            ? {
                kind: "draft",
                exists:
                  useComposerDraftStore.getState().getDraftSession(saved.target.draftId) !== null,
              }
            : { kind: "thread", thread: readThreadShell(saved.target.threadRef) },
      shellAuthoritative:
        savedEnvironmentId !== null &&
        isThreadRouteSnapshotAuthoritative(
          appAtomRegistry.get(environmentShell.statusAtom(savedEnvironmentId)),
        ),
      assistantMain:
        mainThreadRef === null
          ? null
          : { threadRef: mainThreadRef, thread: readThreadShell(mainThreadRef) },
    });
    if (pruneSaved && savedEnvironmentId !== null && saved !== undefined) {
      store.forgetBotLocation(savedEnvironmentId, saved.href);
    }
    if (entry.kind === "saved" && saved !== undefined) {
      void navigate({ href: saved.href });
      return;
    }
    if (entry.kind === "thread") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(entry.threadRef),
      });
      return;
    }
    void navigate({ to: BOTS_HOME_PATH });
  };
}

/** Code | Bots. Each side returns to where it was left; switching never creates anything. */
export function SidebarRoomSwitch({ room }: { room: AppRoom }) {
  const navigate = useNavigate();
  const enterBotsRoom = useEnterBotsRoom();
  const assistantEnvironmentId = useDesignatedAssistantEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const botKeys = botProjectKeys(projects);
  const otherRoomNeedsYou = threads.some(
    (thread) =>
      thread.archivedAt === null &&
      (thread.hasPendingApprovals || thread.hasPendingUserInput) &&
      (botKeys?.has(`${thread.environmentId}:${thread.projectId}`) ?? false) === (room === "code"),
  );

  const botsUnread = threads.some(
    (thread) =>
      thread.archivedAt === null &&
      botKeys?.has(`${thread.environmentId}:${thread.projectId}`) &&
      hasUnseenCompletion(thread),
  );

  const switchTo = (next: AppRoom) => {
    if (next === room) return;
    if (next === "code") {
      void navigate({ href: useBotRoomStore.getState().codeHref ?? "/" });
      return;
    }
    enterBotsRoom(assistantEnvironmentId);
  };

  return (
    <ToggleGroup
      aria-label="Space"
      className="w-full *:flex-1"
      value={[room]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "code" || next === "bots") switchTo(next);
      }}
    >
      <Toggle value="code">
        <CodeIcon />
        Code
        {room === "bots" && otherRoomNeedsYou ? <NeedsYouDot /> : null}
      </Toggle>
      <Toggle value="bots">
        <LayoutGridIcon />
        Bots
        {room === "code" && (otherRoomNeedsYou || botsUnread) ? (
          <NeedsYouDot unread={!otherRoomNeedsYou} />
        ) : null}
      </Toggle>
    </ToggleGroup>
  );
}
