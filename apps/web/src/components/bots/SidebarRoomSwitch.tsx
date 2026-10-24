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
  partitionEnvironmentBots,
  resolveBotsRoomEntry,
  type AppRoom,
} from "./botRoom.logic";
import { useBotRoomStore } from "./botRoomStore";
import { useBotsEnvironmentId } from "./useBotRoom";

function NeedsYouDot() {
  return (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
      <span className="sr-only">, needs you</span>
    </>
  );
}

/**
 * Opens the Bots room for an environment where it was left, or on Assistant when it exists. A
 * saved spot that was deleted is forgotten rather than followed into the missing-thread redirect.
 */
export function useEnterBotsRoom() {
  const navigate = useNavigate();
  return (environmentId: EnvironmentId | null) => {
    const store = useBotRoomStore.getState();
    const saved =
      environmentId === null ? undefined : store.botLocationByEnvironment[environmentId];
    const mainThreadId =
      environmentId === null
        ? null
        : (partitionEnvironmentBots(readProjects(), environmentId).assistant?.botMainThreadId ??
          null);
    const mainThreadRef =
      environmentId !== null && mainThreadId !== null
        ? scopeThreadRef(environmentId, mainThreadId)
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
        environmentId !== null &&
        isThreadRouteSnapshotAuthoritative(
          appAtomRegistry.get(environmentShell.statusAtom(environmentId)),
        ),
      assistantMain:
        mainThreadRef === null
          ? null
          : { threadRef: mainThreadRef, thread: readThreadShell(mainThreadRef) },
    });
    if (pruneSaved && environmentId !== null && saved !== undefined) {
      store.forgetBotLocation(environmentId, saved.href);
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
    if (environmentId !== null) store.setEnvironmentId(environmentId);
    void navigate({ to: BOTS_HOME_PATH });
  };
}

/** Code | Bots. Each side returns to where it was left; switching never creates anything. */
export function SidebarRoomSwitch({ room }: { room: AppRoom }) {
  const navigate = useNavigate();
  const enterBotsRoom = useEnterBotsRoom();
  const environmentId = useBotsEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const botKeys = botProjectKeys(projects);
  const otherRoomNeedsYou = threads.some(
    (thread) =>
      thread.archivedAt === null &&
      (thread.hasPendingApprovals || thread.hasPendingUserInput) &&
      (botKeys?.has(`${thread.environmentId}:${thread.projectId}`) ?? false) === (room === "code"),
  );

  const switchTo = (next: AppRoom) => {
    if (next === room) return;
    if (next === "code") {
      void navigate({ href: useBotRoomStore.getState().codeHref ?? "/" });
      return;
    }
    enterBotsRoom(environmentId);
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
        {room === "code" && otherRoomNeedsYou ? <NeedsYouDot /> : null}
      </Toggle>
    </ToggleGroup>
  );
}
