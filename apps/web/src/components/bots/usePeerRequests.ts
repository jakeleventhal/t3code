import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  peerRequestListTargets,
  peerRequestRows,
  type PeerRequestConversation,
  type PeerRequestEntry,
  type PeerRequestRow,
} from "@t3tools/client-runtime/state/peer-requests";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useRef, useState } from "react";

import { useQuietThreadShell, useServerConfigs } from "../../state/entities";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { peerRequests } from "../../state/peerRequests";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

const EMPTY_ENTRIES_ATOM = Atom.make<ReadonlyArray<PeerRequestEntry>>([]).pipe(
  Atom.withLabel("web-peer-requests:empty"),
);

/**
 * Bot-to-bot requests still on their way to or from this bot conversation, read from every
 * connected host that keeps such an outbox. The conversation's own host may be offline: requests
 * addressed to it still show, because they wait on the requesting bots' hosts.
 */
export function usePeerRequestRows(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): ReadonlyArray<PeerRequestRow> {
  const registry = useContext(RegistryContext);
  const [now] = useState(() => Date.now());
  const configs = useServerConfigs();
  const connected = useConnectedEnvironmentIds();
  const hosts = connected.filter(
    (id) => configs.get(id)?.environment.capabilities.peerMessageOutbox === true,
  );
  const conversation: PeerRequestConversation | null =
    threadId === null
      ? null
      : {
          environmentId,
          threadId,
          outgoing: hosts.includes(environmentId),
          sourceEnvironmentIds: hosts,
        };
  const entries = useAtomValue(
    conversation === null ? EMPTY_ENTRIES_ATOM : peerRequests.conversation(conversation),
  );

  // The lists refetch themselves every 15s while read. This conversation's own request shows up
  // mid-turn, so look again right away when its run or visible items change, or hosts come and go.
  const shell = useQuietThreadShell(threadId === null ? null : { environmentId, threadId });
  const signal = [
    hosts.join(","),
    shell?.latestRun?.runId,
    shell?.runtime?.status,
    shell?.visibleItemCount,
  ].join("|");
  const targetsKey = conversation === null ? null : JSON.stringify(conversation);
  const refreshedFor = useRef(signal);
  useEffect(() => {
    if (targetsKey === null || refreshedFor.current === signal) return;
    refreshedFor.current = signal;
    for (const target of peerRequestListTargets(
      JSON.parse(targetsKey) as PeerRequestConversation,
    )) {
      registry.refresh(
        peerRequests.list({ environmentId: target.environmentId, input: target.input }),
      );
    }
  }, [registry, signal, targetsKey]);

  return conversation === null ? [] : peerRequestRows(entries, now);
}

export function usePeerRequestCanCancel(row: PeerRequestRow): boolean {
  const permitted = useAtomValue(peerRequests.cancel.permissionAtom(row.hostEnvironmentId));
  return row.canCancel && permitted;
}

/** Cancels on the requesting bot's host, which owns the request, then rereads that host's list. */
export function useCancelPeerRequest() {
  const registry = useContext(RegistryContext);
  const cancel = useAtomCommand(peerRequests.cancel, { reportFailure: false });
  return async (row: PeerRequestRow) => {
    const result = await cancel({
      environmentId: row.hostEnvironmentId,
      input: { requestId: row.item.requestId },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t cancel the request",
          description:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "It may already be on its way.",
        }),
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
      registry.refresh(peerRequests.list({ environmentId: row.hostEnvironmentId, input }));
    }
  };
}
