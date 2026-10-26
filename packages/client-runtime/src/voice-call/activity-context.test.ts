import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { describeBotActivity, describeCallWork } from "./activity-context.ts";

const host = EnvironmentId.make("host");
const copy = EnvironmentId.make("copy");
const project: Parameters<typeof describeBotActivity>[0][number] = {
  id: ProjectId.make("bot"),
  environmentId: host,
  title: "Workouty",
  botRole: "specialist",
};
const thread = (
  patch: Partial<Parameters<typeof describeBotActivity>[1][number]> = {},
): Parameters<typeof describeBotActivity>[1][number] => ({
  id: ThreadId.make("main"),
  environmentId: host,
  projectId: project.id,
  title: "Training",
  deletedAt: null,
  archivedAt: null,
  lineage: {
    parentThreadId: null,
    relationshipToParent: null,
    rootThreadId: ThreadId.make("main"),
  },
  runtime: { status: "completed" },
  latestRun: { status: "completed" },
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingBackgroundTasks: [],
  updatedAt: "2026-10-26T12:00:00Z",
  source: { latestVisibleMessage: { role: "assistant", text: "Three-day plan ready." } },
  ...patch,
});
const connected = new Set([host]);

describe("quick bot activity", () => {
  it("prefers a connected copy, deduplicates replicas, and marks offline status unknown", () => {
    const projects = [project, { ...project, environmentId: copy }];
    const threads = [
      thread(),
      thread({
        environmentId: copy,
        updatedAt: "2026-10-26T13:00:00Z",
        runtime: { status: "running" },
      }),
    ];
    const current = describeBotActivity(projects, threads, connected);
    expect(current.match(/"bot":"Workouty"/g)).toHaveLength(1);
    expect(current).toContain('"state":"completed"');
    expect(current).toContain("Three-day plan ready.");
    const offline = describeBotActivity(projects, threads, new Set());
    expect(offline).toContain("unavailable; saved state is not current");
    expect(offline).not.toContain('"state":"running"');
    expect(offline).not.toContain("Three-day plan ready.");
  });
  it("prioritizes pending work and approvals without publishing streaming replies", () => {
    const busy = thread({
      id: ThreadId.make("busy"),
      runtime: { status: "running" },
      hasPendingApprovals: true,
      source: { latestVisibleMessage: { role: "assistant", text: "PARTIAL" } },
    });
    const text = describeBotActivity([project], [thread(), busy], connected);
    expect(text.indexOf('"state":"running"')).toBeLessThan(text.indexOf('"state":"completed"'));
    expect(text).toContain('"needsApproval":true');
    expect(text).not.toContain("PARTIAL");
  });
  it("excludes code projects, archived/deleted topics and incomplete replicas, and bounds multibyte text", () => {
    const excluded = [
      thread({ deletedAt: "now" }),
      thread({ archivedAt: "now" }),
      thread({ projectId: ProjectId.make("code") }),
    ];
    expect(describeBotActivity([project], excluded, connected)).not.toContain('"bot":');
    expect(
      describeBotActivity([{ ...project, botReplicaReady: false }], [thread()], connected),
    ).not.toContain('"bot":');
    const text = describeBotActivity(
      [project],
      Array.from({ length: 20 }, (_, i) =>
        thread({
          id: ThreadId.make(String(i)),
          title: "😀".repeat(5000),
          source: { latestVisibleMessage: { role: "assistant", text: "😀".repeat(5000) } },
        }),
      ),
      connected,
    );
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);
    expect(text).not.toMatch(/\\ud[89ab][0-9a-f]{2}|\\ud[cdef][0-9a-f]{2}/i);
    expect(text).toContain("not proof");
  });
});

const runId = RunId.make("call-work");
const nodeId = NodeId.make("work-node");
const projection = (): Parameters<typeof describeCallWork>[0] => ({
  runs: [{ id: runId, status: "running" }],
  nodes: [{ id: nodeId, runId }],
  runtimeRequests: [],
  messages: [
    {
      id: MessageId.make("voice-work:call:request"),
      runId,
      role: "user",
      text: "INTERNAL HISTORY\nRequest from the live conversation:\nCompare workout plans",
      streaming: false,
    },
  ],
});
it("tracks call requests through input, completion and failure without replaying handoff internals", () => {
  const state = projection();
  expect(describeCallWork(state)).toContain("Compare workout plans");
  expect(describeCallWork(state)).not.toContain("INTERNAL HISTORY");
  expect(
    describeCallWork({
      ...state,
      runtimeRequests: [{ id: RuntimeRequestId.make("approval"), nodeId, status: "pending" }],
    }),
  ).toContain('"needsInput":true');
  const completed = {
    ...state,
    runs: [{ id: runId, status: "completed" as const }],
    messages: [
      ...state.messages,
      {
        id: MessageId.make("answer"),
        runId,
        role: "assistant" as const,
        text: "Plan B fits best.",
        streaming: false,
      },
    ],
  };
  expect(describeCallWork(completed)).toContain('"result":"Plan B fits best."');
  expect(describeCallWork({ ...completed, runs: [{ id: runId, status: "failed" }] })).not.toContain(
    "Plan B fits best.",
  );
  expect(
    describeCallWork({
      ...completed,
      messages: completed.messages.map((m) => ({ ...m, streaming: true })),
    }),
  ).toContain('"result":null');
  expect(describeCallWork({ ...state, runs: [] })).toContain("unknown; run not loaded");
});

it("extracts the actual spoken request and withholds incomplete answers", () => {
  const state = projection();
  const request = state.messages[0]!;
  const messages = [
    {
      ...request,
      text: request.text.replace(
        "Compare workout plans",
        "Handle the latest request. Delegation at 0ms. Recent speech (time ranges are milliseconds):\nCompare the two plans",
      ),
    },
  ];
  expect(describeCallWork({ ...state, messages })).toContain("Compare the two plans");
  expect(describeCallWork({ ...state, messages })).not.toContain("Delegation at");
  const completed = {
    ...state,
    runs: [{ id: runId, status: "completed" as const }],
    messages: [
      ...messages,
      {
        id: MessageId.make("progress"),
        runId,
        role: "assistant" as const,
        text: "Checking",
        streaming: false,
      },
      {
        id: MessageId.make("result"),
        runId,
        role: "assistant" as const,
        text: "Real result",
        streaming: true,
      },
    ],
  };
  expect(describeCallWork(completed)).toContain('"result":null');
  expect(describeCallWork(completed)).not.toContain("Checking");
});
