import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { RunId } from "@t3tools/contracts";

import {
  deriveActiveWorkStartedAt,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import type { ChatMessage } from "../../types";

/** The corner card shows the latest exchanges; Open full chat has the rest. */
export const ASSISTANT_CARD_TURN_LIMIT = 8;

/**
 * The items from the `turns`-th last user message on, so a long conversation derives only what
 * the card can show while a reply streams.
 */
export function recentTurnItems<T extends { readonly item: { readonly type: string } }>(
  items: ReadonlyArray<T>,
  turns: number,
): ReadonlyArray<T> {
  let seen = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.item.type === "user_message") {
      seen += 1;
      if (seen === turns) return items.slice(index);
    }
  }
  return items;
}

export type AssistantCardSender = "you" | "bot" | "routine";

export type AssistantCardRow =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly message: ChatMessage;
      readonly sender: AssistantCardSender;
    }
  | { readonly kind: "assistant"; readonly id: string; readonly message: ChatMessage }
  | {
      readonly kind: "steps";
      readonly id: string;
      readonly runId: RunId | null;
      readonly entries: ReadonlyArray<WorkLogEntry>;
    }
  | { readonly kind: "error"; readonly id: string; readonly text: string }
  | { readonly kind: "artifact"; readonly id: string; readonly label: string };

/** Messages another bot or a routine put in this conversation are labeled, never shown as yours. */
export function assistantCardSender(
  message: Pick<ChatMessage, "createdBy" | "senderThreadId" | "scheduledTaskId">,
): AssistantCardSender {
  if (message.scheduledTaskId !== undefined) return "routine";
  if (message.senderThreadId !== undefined || message.createdBy === "agent") return "bot";
  return "you";
}

/** Timeline entries as the card's rows: each run of tool work folds into one steps row. */
export function assistantCardRows(entries: ReadonlyArray<TimelineEntry>): AssistantCardRow[] {
  const rows: AssistantCardRow[] = [];
  for (const entry of entries) {
    if (entry.kind === "message") {
      const { message } = entry;
      if (message.role === "user") {
        rows.push({ kind: "user", id: entry.id, message, sender: assistantCardSender(message) });
      } else if (message.role === "assistant") {
        if (message.text.trim().length > 0 || message.streaming) {
          rows.push({ kind: "assistant", id: entry.id, message });
        }
      }
      continue;
    }
    if (entry.kind === "work") {
      const work = entry.entry;
      if (work.tone === "error") {
        rows.push({ kind: "error", id: entry.id, text: work.detail?.trim() || work.label });
        continue;
      }
      const previous = rows.at(-1);
      const runId = work.runId ?? null;
      if (previous?.kind === "steps" && previous.runId === runId) {
        rows[rows.length - 1] = { ...previous, entries: [...previous.entries, work] };
      } else {
        rows.push({ kind: "steps", id: entry.id, runId, entries: [work] });
      }
      continue;
    }
    if (entry.kind === "proposed-plan") {
      rows.push({ kind: "artifact", id: entry.id, label: "Proposed a plan" });
    } else if (entry.kind === "html-render" || entry.kind === "mcp-app") {
      rows.push({ kind: "artifact", id: entry.id, label: "Shared an interactive view" });
    }
  }
  return rows;
}

export type AssistantCardTone = "idle" | "sending" | "working" | "needs-you" | "failed" | "offline";

export interface AssistantCardStatus {
  readonly tone: AssistantCardTone;
  readonly label: string;
  /** When the current work started, for a live timer; null when nothing is running. */
  readonly startedAt: string | null;
  readonly error: string | null;
}

type StatusThread = Pick<
  EnvironmentThreadShell,
  "runtime" | "latestRun" | "hasPendingApprovals" | "hasPendingUserInput"
>;

/** What Assistant is doing, from the server's state for its conversation. */
export function resolveAssistantCardStatus(input: {
  readonly connected: boolean;
  readonly sending: boolean;
  readonly thread: StatusThread | null;
}): AssistantCardStatus {
  const { thread } = input;
  if (!input.connected) return { tone: "offline", label: "Offline", startedAt: null, error: null };
  if (thread !== null && (thread.hasPendingApprovals || thread.hasPendingUserInput)) {
    return { tone: "needs-you", label: "Needs you", startedAt: null, error: null };
  }
  const runtime = thread?.runtime ?? null;
  if (thread !== null && threadRuntimeIsActive(runtime)) {
    const status = runtime!.status;
    return {
      tone: "working",
      label:
        status === "preparing" || status === "starting" || status === "queued"
          ? "Starting"
          : status === "waiting"
            ? "Waiting"
            : "Working",
      startedAt: deriveActiveWorkStartedAt(thread.latestRun, runtime, null),
      error: null,
    };
  }
  if (input.sending) return { tone: "sending", label: "Sending…", startedAt: null, error: null };
  if (thread?.latestRun?.status === "failed") {
    return {
      tone: "failed",
      label: "Last reply failed",
      startedAt: null,
      error: runtime?.lastError ?? null,
    };
  }
  return { tone: "idle", label: "Ready", startedAt: null, error: null };
}

/** The step the running reply is on, or null while it has nothing to show yet. */
export function assistantCardCurrentStep(
  rows: ReadonlyArray<AssistantCardRow>,
  activeRunId: RunId | null,
  describe: (entry: WorkLogEntry) => string,
): string | null {
  const last = rows.at(-1);
  if (last === undefined || activeRunId === null) return null;
  if (last.kind === "assistant" && last.message.runId === activeRunId) {
    return last.message.streaming ? "Writing a reply" : null;
  }
  if (last.kind === "steps" && last.runId === activeRunId) {
    const entry = last.entries.at(-1);
    return entry === undefined ? null : describe(entry);
  }
  return null;
}
