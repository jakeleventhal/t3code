import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { PeerRequestRow } from "@t3tools/client-runtime/state/peer-requests";
import type { ScopedThreadRef } from "@t3tools/contracts";

/** Who asked, for a request to this conversation; the work it went to, for one from it. */
export function peerRequestCounterpartRef(row: PeerRequestRow): ScopedThreadRef | null {
  if (row.direction === "incoming") {
    return row.item.sourceThreadId === null
      ? null
      : scopeThreadRef(row.hostEnvironmentId, row.item.sourceThreadId);
  }
  return scopeThreadRef(row.item.environmentId, row.item.result?.threadId ?? row.item.threadId);
}

/** Always names a bot's request, never the user's own words. */
export function peerRequestCounterpartLabel(input: {
  readonly row: PeerRequestRow;
  /** The counterpart conversation's title, when this client has it. */
  readonly title: string | null;
  /** The counterpart's machine, when this client knows it. */
  readonly machine?: string | null;
}): string {
  const { row } = input;
  const title =
    input.title ??
    (row.direction === "incoming" && row.item.sourceTitle.length > 0 ? row.item.sourceTitle : null);
  const name = title !== null ? `“${title}”` : "another bot";
  return `${row.direction === "incoming" ? "From" : "To"} ${name}`;
}
