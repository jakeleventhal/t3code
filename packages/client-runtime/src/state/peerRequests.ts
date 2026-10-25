import {
  type EnvironmentId,
  type PeerMessageOutboxItem,
  type PeerMessageOutboxListInput,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

// A bot's request to a bot on another environment waits in its own (source) host's outbox until a
// client carries it across. These are read-only views of that outbox for the two conversations
// it concerns; delivery, retries and completion notices stay on the server.

const LIST_REFRESH_MS = 15_000;
// Requests delivered at once already show as the sender's tool result. Only one that sat in the
// outbox needs a row saying it went out, and only for a while after.
const DELIVERED_AFTER_WAIT_MS = 5_000;
const DELIVERED_VISIBLE_MS = 60 * 60_000;
const DELIVERED_MAX = 3;

export type PeerRequestDirection = "outgoing" | "incoming";

export interface PeerRequestEntry {
  /** The requesting bot's host, which owns the outbox and its cancel. */
  readonly hostEnvironmentId: EnvironmentId;
  readonly direction: PeerRequestDirection;
  readonly item: PeerMessageOutboxItem;
}

export interface PeerRequestConversation {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Read this conversation's own requests from its host. */
  readonly outgoing: boolean;
  /** Connected hosts, other than this conversation's, that may hold requests addressed to it. */
  readonly sourceEnvironmentIds: ReadonlyArray<EnvironmentId>;
}

export interface PeerRequestListTarget {
  readonly environmentId: EnvironmentId;
  readonly direction: PeerRequestDirection;
  readonly input: PeerMessageOutboxListInput;
}

export function peerRequestListTargets(
  conversation: PeerRequestConversation,
): ReadonlyArray<PeerRequestListTarget> {
  const targets: PeerRequestListTarget[] = [];
  if (conversation.outgoing) {
    targets.push({
      environmentId: conversation.environmentId,
      direction: "outgoing",
      input: { sourceThreadId: conversation.threadId },
    });
  }
  for (const source of [...new Set(conversation.sourceEnvironmentIds)].sort()) {
    if (source === conversation.environmentId) continue;
    targets.push({
      environmentId: source,
      direction: "incoming",
      input: { environmentId: conversation.environmentId, threadId: conversation.threadId },
    });
  }
  return targets;
}

export function createPeerRequestAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:peer-requests:list",
    tag: WS_METHODS.peerMessagesList,
    staleTimeMs: 5_000,
    idleTtlMs: 60_000,
    // Refetched while read, empty or not: a request a bot on another host queues for this
    // conversation leaves no trace on this conversation's own shell, so nothing else would say
    // to look. The server bounds the list, and nothing reads it while no conversation is open.
    refreshIntervalMs: LIST_REFRESH_MS,
  });
  const conversation = Atom.family((key: string) => {
    const targets = peerRequestListTargets(JSON.parse(key) as PeerRequestConversation);
    return Atom.make((get): ReadonlyArray<PeerRequestEntry> => {
      const entries: PeerRequestEntry[] = [];
      for (const target of targets) {
        const result = get(list({ environmentId: target.environmentId, input: target.input }));
        // A host that can't answer (offline, older, no read access) simply contributes nothing.
        for (const item of Option.getOrElse(AsyncResult.value(result), () => [])) {
          entries.push({
            hostEnvironmentId: target.environmentId,
            direction: target.direction,
            item,
          });
        }
      }
      return entries;
    }).pipe(Atom.withLabel(`peer-requests:conversation:${key}`));
  });
  return {
    list,
    conversation: (input: PeerRequestConversation) =>
      conversation(
        JSON.stringify({
          environmentId: input.environmentId,
          threadId: input.threadId,
          outgoing: input.outgoing,
          sourceEnvironmentIds: [...new Set(input.sourceEnvironmentIds)].sort(),
        }),
      ),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-requests:cancel",
      tag: WS_METHODS.peerMessagesCancel,
      scheduler: createAtomCommandScheduler(),
    }),
  };
}

export type PeerRequestRowState = "waiting" | "confirming" | "setup" | "access" | "delivered";

export interface PeerRequestRow extends PeerRequestEntry {
  readonly key: string;
  readonly state: PeerRequestRowState;
  readonly label: string;
  readonly detail: string | null;
  /** Only a request that certainly never left can be withdrawn. */
  readonly canCancel: boolean;
}

function rowState(item: PeerMessageOutboxItem): PeerRequestRowState {
  if (item.status === "delivered") return "delivered";
  if (item.status === "blocked") {
    return item.error === "environment_incompatible" ? "setup" : "access";
  }
  return item.uncertain ? "confirming" : "waiting";
}

const MAY_HAVE_ARRIVED = "It may already have arrived, so it can't be cancelled.";

function rowCopy(
  state: PeerRequestRowState,
  item: PeerMessageOutboxItem,
): { label: string; detail: string | null } {
  switch (state) {
    case "waiting":
      return { label: "Waiting for connection", detail: null };
    case "confirming":
      return { label: "Confirming delivery", detail: MAY_HAVE_ARRIVED };
    case "setup":
      return {
        label: "Setup needed",
        detail: [
          "The receiving machine needs a newer T3 Code to accept requests from other bots.",
          item.uncertain ? MAY_HAVE_ARRIVED : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "access":
      return {
        label: "Access needed",
        detail: [
          "No connected device can send requests to the receiving machine.",
          item.uncertain ? MAY_HAVE_ARRIVED : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
    // `result` describes the moment of delivery, so it can't say whether that work is still
    // running. The other conversation shows its own progress and Stop.
    case "delivered":
      return { label: "Delivered", detail: null };
  }
}

const millis = (iso: string) => Date.parse(iso);

/**
 * What a conversation shows: everything still on its way, oldest first (delivery order), then a
 * few of its own requests that waited and have since gone out. Cancelled ones disappear.
 */
export function peerRequestRows(
  entries: ReadonlyArray<PeerRequestEntry>,
  now: number,
): ReadonlyArray<PeerRequestRow> {
  const seen = new Set<string>();
  const active: PeerRequestRow[] = [];
  const delivered: PeerRequestRow[] = [];
  for (const entry of entries) {
    const key = `${entry.hostEnvironmentId}\u0000${entry.item.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { item } = entry;
    if (item.status === "cancelled") continue;
    if (item.status === "delivered") {
      const waited = millis(item.updatedAt) - millis(item.createdAt) >= DELIVERED_AFTER_WAIT_MS;
      const recent = now - millis(item.updatedAt) <= DELIVERED_VISIBLE_MS;
      if (entry.direction !== "outgoing" || !waited || !recent) continue;
    }
    const state = rowState(item);
    const row: PeerRequestRow = {
      ...entry,
      key,
      state,
      ...rowCopy(state, item),
      canCancel: !item.uncertain && (item.status === "pending" || item.status === "blocked"),
    };
    (state === "delivered" ? delivered : active).push(row);
  }
  active.sort((a, b) => millis(a.item.createdAt) - millis(b.item.createdAt));
  delivered.sort((a, b) => millis(b.item.updatedAt) - millis(a.item.updatedAt));
  return [...active, ...delivered.slice(0, DELIVERED_MAX)];
}

/** Single-line request text for a row. */
export function peerRequestPreview(item: PeerMessageOutboxItem): string {
  return item.text.replace(/\s+/g, " ").trim();
}
