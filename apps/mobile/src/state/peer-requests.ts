import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import {
  createPeerRequestAtoms,
  peerRequestListTargets,
  peerRequestRows,
  type PeerRequestConversation,
  type PeerRequestRow,
} from "@t3tools/client-runtime/state/peer-requests";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import * as Dialog from "../components/ui/Dialog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";
import { environmentPresentations } from "./presentation";
import { environmentThreadShells } from "./threads";
import { useAtomCommand } from "./use-atom-command";

export const peerRequests = createPeerRequestAtoms(connectionAtomRuntime);

/** Connected hosts that keep an outbox of their bots' requests to other environments. */
export function connectedOutboxHosts(
  presentations: ReadonlyMap<
    EnvironmentId,
    Pick<EnvironmentPresentation, "connection" | "serverConfig">
  >,
): ReadonlyArray<EnvironmentId> {
  return [...presentations.entries()]
    .filter(
      ([, presentation]) =>
        presentation.connection.phase === "connected" &&
        presentation.serverConfig?.environment.capabilities.peerMessageOutbox === true,
    )
    .map(([environmentId]) => environmentId)
    .sort();
}

const outboxHostsAtom = Atom.make((get) => {
  const next = connectedOutboxHosts(get(environmentPresentations.presentationsAtom));
  const previous = Option.getOrNull(get.self<ReadonlyArray<EnvironmentId>>());
  return previous !== null && previous.join(",") === next.join(",") ? previous : next;
}).pipe(Atom.withLabel("mobile-peer-requests:outbox-hosts"));

// This conversation's own request shows up mid-turn, so look again right away when its run or
// visible items change. The quiet shell keeps streaming ticks out of this.
const selectActivity = (shell: EnvironmentThreadShell | null) =>
  [shell?.latestRun?.runId, shell?.runtime?.status, shell?.visibleItemCount].join("|");

/**
 * Bot-to-bot requests still on their way to or from this bot conversation, read from every
 * connected host that keeps such an outbox. The conversation's own host may be offline: requests
 * addressed to it still show, because they wait on the requesting bots' hosts.
 */
export function usePeerRequestRows(ref: ScopedThreadRef): ReadonlyArray<PeerRequestRow> {
  const [now] = useState(() => Date.now());
  const hosts = useAtomValue(outboxHostsAtom);
  const conversation: PeerRequestConversation = {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
    outgoing: hosts.includes(ref.environmentId),
    sourceEnvironmentIds: hosts,
  };
  const entries = useAtomValue(peerRequests.conversation(conversation));
  const activity = useAtomValue(environmentThreadShells.quietThreadShellAtom(ref), selectActivity);

  // The lists refetch themselves every 15s while read; this only makes a change seen here or a
  // host coming or going show without that wait.
  const signal = `${hosts.join(",")}|${activity}`;
  const targetsKey = JSON.stringify(conversation);
  const refreshedFor = useRef(signal);
  useEffect(() => {
    if (refreshedFor.current === signal) return;
    refreshedFor.current = signal;
    for (const target of peerRequestListTargets(
      JSON.parse(targetsKey) as PeerRequestConversation,
    )) {
      appAtomRegistry.refresh(
        peerRequests.list({ environmentId: target.environmentId, input: target.input }),
      );
    }
  }, [signal, targetsKey]);

  return peerRequestRows(entries, now);
}

/** Withdrawing a request is the requesting bot's host's call, so its permission decides. */
export function usePeerRequestCanCancel(row: PeerRequestRow): boolean {
  const permitted = useAtomValue(peerRequests.cancel.permissionAtom(row.hostEnvironmentId));
  return row.canCancel && permitted;
}

/** Cancels on the requesting bot's host, which owns the request, then rereads that host's list. */
export function useCancelPeerRequest() {
  const cancel = useAtomCommand(peerRequests.cancel, { reportFailure: false });
  return async (row: PeerRequestRow) => {
    const result = await cancel({
      environmentId: row.hostEnvironmentId,
      input: { requestId: row.item.requestId },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Couldn’t cancel the request",
        error instanceof Error && error.message.length > 0
          ? error.message
          : "It may already be on its way.",
      );
    }
    // The same list input the conversation read, so the refresh reaches its atom.
    const input =
      row.direction === "incoming"
        ? { environmentId: row.item.environmentId, threadId: row.item.threadId }
        : row.item.sourceThreadId === null
          ? null
          : { sourceThreadId: row.item.sourceThreadId };
    if (input !== null) {
      appAtomRegistry.refresh(peerRequests.list({ environmentId: row.hostEnvironmentId, input }));
    }
  };
}
