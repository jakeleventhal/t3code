import * as Option from "effect/Option";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "../state/threadState.ts";
import { createVoiceCallThreadTracker } from "./environment-runtime.ts";
import { MessageId, NodeId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createVoiceContextTracker, voiceWorkUpdate } from "./environment-runtime.ts";

it("delivers typed edits and inherited work that finish while the call is connecting exactly once", () => {
  const oldRun = RunId.make("old-finished");
  const pendingRun = RunId.make("inherited-work");
  const newRun = RunId.make("this-call-work");
  const message = (id: string, text: string, runId: RunId | null = null) => ({
    id: MessageId.make(id),
    text,
    runId,
    role: "user" as const,
    streaming: false,
  });
  const initial = {
    messages: [
      message("typed", "Before connection"),
      message("voice-work:old", "Old work", oldRun),
      message("voice-work:pending", "Pending work", pendingRun),
    ],
    runs: [
      { id: oldRun, status: "completed" as const },
      { id: pendingRun, status: "running" as const },
    ],
  };
  const track = createVoiceContextTracker(initial);
  const connected = {
    messages: [
      message("typed", "Corrected during connection"),
      ...initial.messages.slice(1),
      message("new", "Typed during connection"),
      message("voice-work:new", "New delegation", newRun),
    ],
    runs: [
      ...initial.runs.map((run) => ({ ...run, status: "completed" as const })),
      { id: newRun, status: "running" as const },
    ],
  };
  expect(track(connected)).toEqual({
    updates: [
      "The user corrected a message in this conversation: Corrected during connection",
      "The user typed a message in this conversation: Typed during connection",
    ],
    work: [{ runId: pendingRun, messageId: MessageId.make("voice-work:pending") }],
  });
  expect(track(connected)).toEqual({ updates: [], work: [] });
});

describe("voice work result delivery", () => {
  const runId = RunId.make("requested");
  const other = RunId.make("unrelated");
  const nodeId = NodeId.make("requested-node");
  const projection = (): Parameters<typeof voiceWorkUpdate>[0] => ({
    runs: [
      { id: runId, status: "running" },
      { id: other, status: "completed" },
    ],
    messages: [
      { runId: other, role: "assistant", text: "Unrelated finished work", streaming: false },
    ],
    runtimeRequests: [],
    nodes: [{ id: nodeId, runId }],
  });

  it("waits for the selected run and its final text without replaying unrelated work", () => {
    const state = projection();
    expect(voiceWorkUpdate(state, runId)).toBeNull();
    const complete = { ...state, runs: [{ id: runId, status: "completed" as const }] };
    const messages = [
      ...state.messages,
      { runId, role: "assistant" as const, text: "Login checks passed.", streaming: true },
    ];
    expect(voiceWorkUpdate({ ...complete, messages }, runId)).toBeNull();
    expect(
      voiceWorkUpdate(
        { ...complete, messages: messages.map((message) => ({ ...message, streaming: false })) },
        runId,
      ),
    ).toEqual({ status: "completed", text: "Login checks passed." });
  });

  it("announces a pending request only for the delegated run", () => {
    const waiting = { ...projection(), runs: [{ id: runId, status: "waiting" as const }] };
    expect(
      voiceWorkUpdate(
        {
          ...waiting,
          runtimeRequests: [{ nodeId: NodeId.make("another-node"), status: "pending" }],
        },
        runId,
      ),
    ).toBeNull();
    expect(
      voiceWorkUpdate({ ...waiting, runtimeRequests: [{ nodeId, status: "pending" }] }, runId),
    ).toMatchObject({ status: "waiting" });
  });

  it("reports an empty terminal answer as a failed request rather than claiming results exist", () => {
    expect(
      voiceWorkUpdate({ ...projection(), runs: [{ id: runId, status: "completed" }] }, runId),
    ).toMatchObject({ status: "failed", text: expect.stringContaining("without an answer") });
  });

  it("does not turn a failed or cancelled run into a success from partial text", () => {
    const base = projection();
    const messages = [
      { runId, role: "assistant" as const, text: "Starting the checks…", streaming: false },
    ];
    expect(
      voiceWorkUpdate({ ...base, runs: [{ id: runId, status: "failed" }], messages }, runId),
    ).toEqual({ status: "failed", text: "Starting the checks…" });
    expect(
      voiceWorkUpdate({ ...base, runs: [{ id: runId, status: "cancelled" }] }, runId),
    ).toMatchObject({ status: "cancelled" });
  });
});

describe("call connection lifetime", () => {
  it("keeps audio through shell/item synchronization but stops after a real disconnect", () => {
    const tracker = createVoiceCallThreadTracker("endpoint");
    const empty = EMPTY_ENVIRONMENT_THREAD_STATE;
    expect(tracker.observe(empty)).toBeNull();
    const live = { ...empty, status: "live" as const, data: Option.some({ turnItems: [] }) };
    expect(tracker.observe(live)).toBeNull();
    expect(tracker.observe({ ...live, status: "synchronizing" })).toBeNull();
    expect(tracker.observe(live)).toBeNull();
    expect(tracker.observe({ ...live, status: "cached" })).toMatchObject({ type: "failed" });
  });
  it("stops when the conversation is deleted even before it first loads", () => {
    expect(
      createVoiceCallThreadTracker("endpoint").observe({
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        status: "deleted",
      }),
    ).toMatchObject({ type: "failed" });
  });
});
