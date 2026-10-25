import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import {
  assistantCardCurrentStep,
  assistantCardRows,
  recentTurnItems,
  resolveAssistantCardStatus,
} from "./assistantCard.logic";

const runA = RunId.make("run-a");
const runB = RunId.make("run-b");
const at = "2026-10-24T21:36:20.000Z";

function message(
  id: string,
  role: ChatMessage["role"],
  text: string,
  extra: Partial<ChatMessage> = {},
): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: at,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId: runA,
      streaming: false,
      createdAt: at,
      updatedAt: at,
      ...extra,
    },
  };
}

function work(id: string, runId: RunId, extra: Partial<WorkLogEntry> = {}): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: at,
    entry: { id, createdAt: at, runId, label: id, tone: "tool", ...extra },
  };
}

describe("recentTurnItems", () => {
  const items = ["user_message", "assistant_message", "user_message", "tool", "user_message"].map(
    (type, index) => ({ index, item: { type } }),
  );

  it("starts at the requested number of user messages back", () => {
    expect(recentTurnItems(items, 2).map(({ index }) => index)).toEqual([2, 3, 4]);
  });

  it("keeps everything when the conversation is shorter than the window", () => {
    expect(recentTurnItems(items, 8)).toHaveLength(5);
  });
});

describe("assistantCardRows", () => {
  it("folds each run's consecutive tool work into one steps row", () => {
    const rows = assistantCardRows([
      message("u1", "user", "what's in this thread?"),
      work("w1", runA),
      work("w2", runA),
      message("a1", "assistant", "Here's what I found."),
      work("w3", runB),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["user", "steps", "assistant", "steps"]);
    expect(rows[1]).toMatchObject({ runId: runA, entries: [{ id: "w1" }, { id: "w2" }] });
  });

  it("shows tool errors as their own rows instead of hiding them in a group", () => {
    const rows = assistantCardRows([
      work("w1", runA),
      work("w2", runA, { tone: "error", detail: "Provider rate limited" }),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["steps", "error"]);
    expect(rows[1]).toMatchObject({ text: "Provider rate limited" });
  });

  it("labels messages another bot or a routine sent, so they never read as the user's", () => {
    const rows = assistantCardRows([
      message("u1", "user", "mine"),
      message("u2", "user", "from a bot", { createdBy: "agent" }),
      message("u3", "user", "remind me", { scheduledTaskId: "task" as never }),
    ]);
    expect(rows.map((row) => (row.kind === "user" ? row.sender : null))).toEqual([
      "you",
      "bot",
      "routine",
    ]);
  });

  it("keeps a streaming reply that has no text yet and drops empty settled ones", () => {
    const rows = assistantCardRows([
      message("a1", "assistant", "", { streaming: false }),
      message("a2", "assistant", "", { streaming: true }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a2"]);
  });
});

describe("resolveAssistantCardStatus", () => {
  const idleThread = {
    runtime: null,
    latestRun: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  };
  const runningThread = {
    ...idleThread,
    latestRun: {
      runId: runA,
      status: "running" as const,
      requestedAt: at,
      startedAt: at,
      completedAt: null,
      assistantMessageId: null,
    },
    runtime: {
      status: "running" as const,
      activeRunId: runA,
      providerInstanceId: "claude" as never,
      providerName: null,
      lastError: null,
      updatedAt: at,
    },
  };

  it("never claims work while the environment is offline", () => {
    expect(
      resolveAssistantCardStatus({ connected: false, sending: true, thread: runningThread }),
    ).toMatchObject({ tone: "offline", label: "Offline", startedAt: null });
  });

  it("reports a running reply with the time it started", () => {
    expect(
      resolveAssistantCardStatus({ connected: true, sending: false, thread: runningThread }),
    ).toEqual({ tone: "working", label: "Working", startedAt: at, error: null });
  });

  it("puts a pending approval ahead of the running state", () => {
    expect(
      resolveAssistantCardStatus({
        connected: true,
        sending: false,
        thread: { ...runningThread, hasPendingApprovals: true },
      }).tone,
    ).toBe("needs-you");
  });

  it("shows Sending only until the server has the run, then the run's own state", () => {
    expect(
      resolveAssistantCardStatus({ connected: true, sending: true, thread: idleThread }).tone,
    ).toBe("sending");
    expect(
      resolveAssistantCardStatus({ connected: true, sending: true, thread: runningThread }).tone,
    ).toBe("working");
  });

  it("surfaces the last failure with the provider's error", () => {
    const failed = {
      ...runningThread,
      latestRun: { ...runningThread.latestRun, status: "failed" as const, completedAt: at },
      runtime: {
        ...runningThread.runtime,
        status: "failed" as const,
        activeRunId: null,
        lastError: "Usage limit reached",
      },
    };
    expect(
      resolveAssistantCardStatus({ connected: true, sending: false, thread: failed }),
    ).toMatchObject({ tone: "failed", error: "Usage limit reached" });
  });
});

describe("assistantCardCurrentStep", () => {
  const describeEntry = (entry: WorkLogEntry) => `step ${entry.id}`;

  it("names the latest step of the running reply", () => {
    const rows = assistantCardRows([work("w1", runA), work("w2", runA)]);
    expect(assistantCardCurrentStep(rows, runA, describeEntry)).toBe("step w2");
  });

  it("says the reply is being written while its text streams", () => {
    const rows = assistantCardRows([
      work("w1", runA),
      message("a1", "assistant", "Partial", { streaming: true }),
    ]);
    expect(assistantCardCurrentStep(rows, runA, describeEntry)).toBe("Writing a reply");
  });

  it("ignores an earlier run's steps", () => {
    const rows = assistantCardRows([work("w1", runA)]);
    expect(assistantCardCurrentStep(rows, runB, describeEntry)).toBeNull();
  });
});
