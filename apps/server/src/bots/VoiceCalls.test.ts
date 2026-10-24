import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type VoiceTranscriptEntry,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SqlClient from "effect/sql/SqlClient";

import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as TurnItemPositionStore from "../orchestration-v2/TurnItemPositionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  projectDomainEventForWire,
  projectThreadProjectionForWire,
  projectTurnItemForDetail,
  projectTurnItemForWire,
} from "../orchestration-v2/WireProjection.ts";
import * as VoiceCalls from "./VoiceCalls.ts";
import { historicalMessage, selectHistory } from "@t3tools/provider-core/server/handoffBudget";

const dependencies = Layer.mergeAll(
  RuntimeLayer.layerEventSink,
  ProjectionStore.layer,
  ProjectStore.layer,
  TurnItemPositionStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory), Layer.provideMerge(NodeServices.layer));
const testLayer = VoiceCalls.layer.pipe(Layer.provideMerge(dependencies));
const threadId = ThreadId.make("voice-thread");
const owner = "desktop-endpoint";
const first = { threadId, callId: "first", owner };
const entry = (ordinal: number, text = `Line ${ordinal}`): VoiceTranscriptEntry => ({
  id: `line-${ordinal}`,
  ordinal,
  speaker: ordinal % 2 === 0 ? "user" : "bot",
  text,
  revision: 0,
  final: true,
});

const fixture = Effect.gen(function* () {
  const sink = yield* EventSink.EventSinkV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const now = yield* DateTime.now;
  const at = DateTime.formatIso(now);
  const projectId = ProjectId.make("voice-project");
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test-model" };
  yield* projects.apply({
    sequence: 1,
    eventId: EventId.make("project"),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: at,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId,
      title: "Assistant",
      botRole: "assistant",
      workspaceRoot: "/tmp/voice-test",
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: at,
      updatedAt: at,
    },
  });
  yield* sink.write({
    events: [
      {
        id: EventId.make("thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          id: threadId,
          projectId,
          title: "Assistant",
          modelSelection,
          providerInstanceId: modelSelection.instanceId,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdBy: "user",
          creationSource: "web",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      },
    ],
  });
  return yield* VoiceCalls.VoiceCalls;
});

it.effect(
  "call retries and transcript revisions preserve one card and corrected conversation text",
  () =>
    Effect.gen(function* () {
      const calls = yield* fixture;
      const opened = yield* calls.begin(first);
      assert.deepEqual(yield* calls.begin(first), opened);
      yield* calls.append({ ...first, entries: [{ ...entry(0, "uncertain"), final: false }] });
      yield* calls.append({
        ...first,
        entries: [{ ...entry(0, "corrected"), revision: 2 }, entry(1)],
      });
      yield* calls.append({
        ...first,
        entries: [
          { ...entry(0, "old replay"), revision: 1 },
          { ...entry(0, "interim replay"), revision: 3, final: false },
        ],
      });
      assert.deepEqual(
        (yield* calls.transcript(first)).entries.map((e) => e.text),
        ["corrected", "Line 1"],
      );
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const records = yield* projections.getThreadRecords(threadId, ["messages", "turnItems"]);
      assert.equal(records.turnItems.length, 1);
      assert.equal(records.turnItems[0]?.type, "voice_call");
      assert.equal(records.messages.length, 2);
      assert.deepEqual(
        records.messages.map((m) => m.role),
        ["user", "assistant"],
      );
      assert.equal(records.messages[0]?.text, "corrected");
      yield* calls.end({ ...first, reason: "user", entries: [entry(2, "Goodbye")] });
      yield* calls.end({ ...first, reason: "error" });
      assert.equal((yield* calls.transcript(first)).entries.length, 3);
      assert.equal(
        (yield* Effect.flip(calls.append({ ...first, entries: [entry(3)] }))).reason,
        "ended",
      );
      assert.equal((yield* Effect.flip(calls.begin(first))).reason, "ended");
    }).pipe(Effect.provide(testLayer)),
);

it.effect("replacement is atomic and stale device messages cannot change the new call", () =>
  Effect.gen(function* () {
    const calls = yield* fixture;
    yield* calls.begin(first);
    const phone = { threadId, callId: "phone", owner: "phone-endpoint" };
    assert.equal((yield* Effect.flip(calls.begin(phone))).reason, "active-call-changed");
    assert.equal(
      (yield* Effect.flip(calls.append({ ...first, owner: phone.owner, entries: [entry(0)] })))
        .reason,
      "owner-changed",
    );
    yield* calls.begin({ ...phone, replacingCallId: first.callId });
    assert.equal(
      (yield* Effect.flip(calls.append({ ...first, entries: [entry(0)] }))).reason,
      "ended",
    );
    yield* calls.end({ ...first, reason: "user", entries: [entry(0, "Last desktop words")] });
    yield* calls.append({ ...phone, entries: [entry(0, "Continuing here")] });
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { turnItems } = yield* projections.getThreadRecords(threadId, ["turnItems"]);
    assert.equal(turnItems.filter((item) => item.status === "running").length, 1);
    assert.equal(
      turnItems.find((item) => item.type === "voice_call" && item.call.callId === "first")?.status,
      "completed",
    );
    assert.equal(
      (yield* Effect.flip(calls.begin({ ...first, callId: "third", replacingCallId: "first" })))
        .reason,
      "active-call-changed",
    );
    assert.equal((yield* calls.transcript(phone)).entries[0]?.text, "Continuing here");
    assert.equal((yield* calls.transcript(first)).entries[0]?.text, "Last desktop words");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("concurrent starts admit one call without creating extra cards", () =>
  Effect.gen(function* () {
    const calls = yield* fixture;
    const results = yield* Effect.all(
      Array.from({ length: 8 }, (_, index) =>
        calls.begin({ ...first, callId: `race-${index}` }).pipe(Effect.result),
      ),
      { concurrency: "unbounded" },
    );
    assert.equal(results.filter(Result.isSuccess).length, 1);
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    assert.equal(
      (yield* projections.getThreadRecords(threadId, ["turnItems"])).turnItems.length,
      1,
    );
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "transcript pages are bounded, ordered, scoped, and reject ordinal conflicts atomically",
  () =>
    Effect.gen(function* () {
      const calls = yield* fixture;
      yield* calls.begin(first);
      for (let start = 0; start < 70; start += 30) {
        yield* calls.append({
          ...first,
          entries: Array.from({ length: Math.min(30, 70 - start) }, (_, n) =>
            entry(start + n),
          ).toReversed(),
        });
      }
      const page = yield* calls.transcript(first);
      assert.equal(page.entries.length, 64);
      assert.equal(page.nextOrdinal, 63);
      assert.deepEqual(
        page.entries.map((e) => e.ordinal),
        Array.from({ length: 64 }, (_, n) => n),
      );
      const last = yield* calls.transcript({ ...first, afterOrdinal: page.nextOrdinal! });
      assert.equal(last.entries.length, 6);
      assert.equal(last.nextOrdinal, null);
      assert.equal(
        (yield* Effect.flip(
          calls.append({ ...first, entries: [entry(70), { ...entry(71), ordinal: 1 }] }),
        )).reason,
        "invalid-entry",
      );
      assert.equal((yield* calls.transcript({ ...first, afterOrdinal: 69 })).entries.length, 0);
      assert.equal(
        (yield* Effect.flip(calls.transcript({ ...first, threadId: ThreadId.make("other") })))
          .reason,
        "not-found",
      );
      const sql = yield* SqlClient.SqlClient;
      const plan = yield* sql<{
        detail: string;
      }>`EXPLAIN QUERY PLAN SELECT payload_json FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId} AND json_extract(payload_json, '$.voiceCall.callId') IS NOT NULL AND json_extract(payload_json, '$.voiceCall.callId') = 'first' AND json_extract(payload_json, '$.voiceCall.ordinal') > 0 ORDER BY json_extract(payload_json, '$.voiceCall.ordinal') LIMIT 65`;
      assert.isTrue(plan.some((row) => row.detail.includes("voice_transcript_ordinal_idx")));
    }).pipe(Effect.provide(testLayer)),
);

it.effect("a restarted service closes abandoned calls and keeps their transcript", () =>
  Effect.gen(function* () {
    const calls = yield* fixture;
    yield* calls.begin(first);
    yield* calls.append({ ...first, entries: [entry(0)] });
    yield* Effect.gen(function* () {
      const restarted = yield* VoiceCalls.VoiceCalls;
      assert.equal((yield* restarted.transcript(first)).entries.length, 1);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const saved = yield* projections.getTurnItem({
        threadId,
        itemId: TurnItemId.make("voice-call:first"),
      });
      assert.equal(saved?.type === "voice_call" ? saved.call.endReason : null, "interrupted");
      yield* restarted.begin({ ...first, callId: "after-restart", owner: "phone" });
    }).pipe(Effect.provide(Layer.fresh(VoiceCalls.layer)));
  }).pipe(Effect.provide(testLayer)),
);

it.effect("failed end commits neither final text nor status, and can be retried", () =>
  Effect.gen(function* () {
    const calls = yield* fixture;
    yield* calls.begin(first);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TEMP TRIGGER fail_call_end BEFORE UPDATE ON orchestration_v2_projection_turn_items WHEN NEW.type = 'voice_call' AND NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'test commit failure'); END`;
    assert.equal(
      (yield* Effect.flip(
        calls.end({ ...first, reason: "user", entries: [entry(0, "final text")] }),
      )).reason,
      "storage",
    );
    assert.equal((yield* calls.transcript(first)).entries.length, 0);
    yield* sql`DROP TRIGGER fail_call_end`;
    yield* calls.end({ ...first, reason: "user", entries: [entry(0, "final text")] });
    assert.equal((yield* calls.transcript(first)).entries[0]?.text, "final text");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("call cards stay chronological and wire views omit transcript and ownership", () =>
  Effect.gen(function* () {
    const calls = yield* fixture;
    const positions = yield* TurnItemPositionStore.TurnItemPositionStoreV2;
    const previous = yield* positions.allocate({
      threadId,
      turnItemId: TurnItemId.make("previous"),
      runId: null,
      runOrdinal: 3,
    });
    yield* calls.begin(first);
    const fragments = [
      { id: "fragment-private", text: "private transcript", startMs: 123, endMs: 456 },
    ];
    yield* calls.append({ ...first, entries: [{ ...entry(0, "private transcript"), fragments }] });
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { turnItems, messages } = yield* projections.getThreadRecords(threadId, [
      "turnItems",
      "messages",
    ]);
    const call = turnItems[0]!;
    assert.isAbove(call.ordinal, previous);
    assert.isBelow(call.ordinal, 4_000_000);
    assert.notProperty(projectTurnItemForWire(call), "voiceOwner");
    assert.notProperty(projectTurnItemForDetail(call), "voiceOwner");
    const history = historicalMessage(call);
    assert.isNotNull(history);
    const selected = selectHistory({
      messages: [history!],
      coverage: "Recent conversation",
      budget: 4_000,
    });
    assert.include(selected.messages[0]!.text, "t3_bot_call_read");
    assert.include(selected.messages[0]!.text, 'callId:"first"');
    const message = messages[0]!;
    const projected = projectDomainEventForWire({
      id: EventId.make("wire"),
      threadId,
      type: "message.updated",
      occurredAt: message.updatedAt,
      payload: message,
    });
    assert.notInclude(JSON.stringify(projected), "private transcript");
    assert.notInclude(JSON.stringify(projected), "fragment-private");
    assert.equal(
      projected.type === "message.updated" ? projected.payload.textOmitted : false,
      true,
    );
    const full = yield* projections.getThreadProjection(threadId);
    const wire = projectThreadProjectionForWire(full);
    assert.notInclude(JSON.stringify(wire), "private transcript");
    assert.notInclude(JSON.stringify(wire), "fragment-private");
    assert.notInclude(JSON.stringify(wire), "desktop-endpoint");
    assert.equal(wire.messages[0]?.textOmitted, true);
    assert.equal(full.messages[0]?.text, "private transcript");
    assert.equal((yield* calls.transcript(first)).entries[0]?.text, "private transcript");
    assert.deepEqual((yield* calls.transcript(first)).entries[0]?.fragments, fragments);
    assert.equal(
      (yield* Effect.flip(
        calls.append({ ...first, entries: [{ ...entry(1, "different"), fragments }] }),
      )).reason,
      "invalid-entry",
    );
    yield* calls.end({ ...first, reason: "user" });
    assert.equal(
      (yield* projections.getTurnItem({ threadId, itemId: call.id }))?.ordinal,
      call.ordinal,
    );
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "device transfer keeps one card and lets the previous device drain without ending its successor",
  () =>
    Effect.gen(function* () {
      const calls = yield* fixture;
      const desktop = { ...first, endpointId: "desktop" };
      const original = yield* calls.begin(desktop);
      yield* calls.append({ ...desktop, entries: [entry(0, "before transfer")] });
      const phone = {
        ...first,
        owner: "phone-session",
        endpointId: "phone",
        replacingCallId: first.callId,
        replacingEndpointId: "desktop",
      };
      const moved = yield* calls.begin(phone);
      assert.equal(moved.callId, original.callId);
      assert.equal(moved.startedAt, original.startedAt);
      assert.equal(moved.endpointId, "phone");
      assert.equal(
        (yield* Effect.flip(
          calls.begin({ ...phone, owner: "racing-tablet", endpointId: "tablet" }),
        )).reason,
        "active-call-changed",
      );
      assert.equal((yield* Effect.flip(calls.authorize(desktop))).reason, "owner-changed");
      yield* calls.append({ ...phone, entries: [entry(0, "on the phone")] });
      yield* calls.end({
        ...desktop,
        reason: "replaced",
        entries: [entry(1, "last desktop words")],
      });
      yield* calls.authorize(phone);
      assert.deepEqual(
        (yield* calls.transcript(first)).entries.map((row) => row.text),
        ["before transfer", "last desktop words", "on the phone"],
      );
      const projection = yield* (yield* ProjectionStore.ProjectionStoreV2).getThreadRecords(
        threadId,
        ["turnItems"],
      );
      assert.equal(projection.turnItems.length, 1);
      const wire = projectTurnItemForWire(projection.turnItems[0]!);
      assert.notProperty(wire, "voiceOwner");
      assert.notProperty(wire, "voiceWriters");
      assert.equal(
        (yield* Effect.flip(
          calls.begin({ ...desktop, replacingCallId: first.callId, replacingEndpointId: "phone" }),
        )).reason,
        "owner-changed",
      );
      yield* calls.end({ ...phone, reason: "user" });
      assert.isNull(yield* calls.active());
    }).pipe(Effect.provide(testLayer)),
);
