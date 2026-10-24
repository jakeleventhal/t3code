import {
  EventId,
  MessageId,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2TurnItemJson,
  TurnItemId,
  VoiceCallError,
  VoiceTranscriptEntry,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type ThreadId,
  type VoiceCallEndReason,
  type VoiceCallSummary,
  type VoiceActiveCall,
  type VoiceTranscriptPage,
  type VoiceTranscriptPageInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

type CallItem = Extract<OrchestrationV2TurnItem, { type: "voice_call" }>;
interface OwnedCall {
  readonly threadId: ThreadId;
  readonly callId: string;
  /** Authenticated client session plus a per-tab endpoint id, supplied by the transport. */
  readonly owner: string;
  readonly endpointId?: string | undefined;
}

export class VoiceCalls extends Context.Service<
  VoiceCalls,
  {
    readonly active: () => Effect.Effect<VoiceActiveCall, VoiceCallError>;
    readonly authorize: (input: OwnedCall) => Effect.Effect<void, VoiceCallError>;
    readonly begin: (
      input: OwnedCall & {
        readonly replacingCallId?: string | undefined;
        readonly replacingEndpointId?: string | undefined;
      },
    ) => Effect.Effect<VoiceCallSummary, VoiceCallError>;
    readonly append: (
      input: OwnedCall & { readonly entries: ReadonlyArray<VoiceTranscriptEntry> },
    ) => Effect.Effect<void, VoiceCallError>;
    readonly end: (
      input: OwnedCall & {
        readonly reason: VoiceCallEndReason;
        readonly entries?: ReadonlyArray<VoiceTranscriptEntry> | undefined;
      },
    ) => Effect.Effect<void, VoiceCallError>;
    readonly transcript: (
      input: VoiceTranscriptPageInput,
    ) => Effect.Effect<VoiceTranscriptPage, VoiceCallError>;
  }
>()("t3/bots/VoiceCalls") {}

const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2TurnItemJson));
const decodeMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ConversationMessageJson),
);
const decodeEntries = Schema.decodeUnknownEffect(
  Schema.Array(VoiceTranscriptEntry).check(Schema.isMaxLength(32)),
);
const itemId = (callId: string) => TurnItemId.make(`voice-call:${callId}`);
const messageId = (callId: string, entryId: string) =>
  MessageId.make(`voice:${JSON.stringify([callId, entryId])}`);
const isVoiceCallError = Schema.is(VoiceCallError);
const storageError = (cause: unknown) =>
  isVoiceCallError(cause) ? cause : new VoiceCallError({ reason: "storage", cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);

  const read = Effect.fn("VoiceCalls.read")(function* (callId: string) {
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE turn_item_id = ${itemId(callId)}`;
    if (rows.length === 0) return null;
    const item = yield* decodeItem(rows[0]!.payload_json);
    if (item.type !== "voice_call") return yield* new VoiceCallError({ reason: "not-found" });
    return item;
  }, Effect.mapError(storageError));

  const active = Effect.fn("VoiceCalls.active")(function* () {
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE type = 'voice_call' AND status = 'running'`;
    const items = yield* Effect.forEach(rows, (row) => decodeItem(row.payload_json));
    return items.filter((item): item is CallItem => item.type === "voice_call");
  }, Effect.mapError(storageError));

  const requireThread = Effect.fn("VoiceCalls.requireThread")(function* (threadId: ThreadId) {
    const thread = yield* projections.getThread(threadId).pipe(
      Effect.catchTags({
        ProjectionStoreThreadNotFoundError: () =>
          Effect.fail(new VoiceCallError({ reason: "not-found" })),
      }),
    );
    if (thread.deletedAt !== null) return yield* new VoiceCallError({ reason: "not-found" });
    return thread;
  }, Effect.mapError(storageError));

  const owned = Effect.fn("VoiceCalls.owned")(function* (input: OwnedCall) {
    yield* requireThread(input.threadId);
    const call = yield* read(input.callId);
    if (call === null || call.threadId !== input.threadId)
      return yield* new VoiceCallError({ reason: "not-found" });
    if (call.voiceOwner !== input.owner)
      return yield* new VoiceCallError({ reason: "owner-changed" });
    return call;
  });

  const authorize = Effect.fn("VoiceCalls.authorize")(function* (input: OwnedCall) {
    const call = yield* owned(input);
    if (call.call.endedAt !== null) return yield* new VoiceCallError({ reason: "ended" });
  });

  const itemEvent = Effect.fn("VoiceCalls.itemEvent")(function* (item: CallItem) {
    return {
      id: EventId.make(yield* crypto.randomUUIDv4()),
      type: "turn-item.updated" as const,
      threadId: item.threadId,
      occurredAt: item.updatedAt,
      payload: item,
    };
  }, Effect.mapError(storageError));

  const endedItem = (call: CallItem, now: DateTime.Utc, reason: VoiceCallEndReason): CallItem => ({
    ...call,
    call: { ...call.call, endedAt: DateTime.formatIso(now), endReason: reason },
    status: reason === "error" ? "failed" : reason === "interrupted" ? "interrupted" : "completed",
    completedAt: now,
    updatedAt: now,
  });

  const begin = Effect.fn("VoiceCalls.begin")(
    function* (
      input: OwnedCall & {
        readonly replacingCallId?: string | undefined;
        readonly replacingEndpointId?: string | undefined;
      },
    ) {
      const thread = yield* requireThread(input.threadId);
      const existing = yield* read(input.callId);
      if (existing !== null) {
        if (existing.threadId !== input.threadId)
          return yield* new VoiceCallError({ reason: "not-found" });
        if (existing.call.endedAt !== null) return yield* new VoiceCallError({ reason: "ended" });
        if (existing.voiceOwner === input.owner) return existing.call;
        if (input.replacingCallId !== input.callId)
          return yield* new VoiceCallError({ reason: "owner-changed" });
        if (input.replacingEndpointId !== existing.call.endpointId)
          return yield* new VoiceCallError({ reason: "active-call-changed" });
        const writers = existing.voiceWriters ?? [
          { owner: existing.voiceOwner ?? "", ordinalOffset: 0 },
        ];
        if (writers.some((writer) => writer.owner === input.owner))
          return yield* new VoiceCallError({ reason: "owner-changed" });
        const moved: CallItem = {
          ...existing,
          voiceOwner: input.owner,
          voiceWriters: [
            ...writers,
            { owner: input.owner, ordinalOffset: writers.length * 1_000_000 },
          ],
          call: {
            ...existing.call,
            ...(input.endpointId === undefined ? {} : { endpointId: input.endpointId }),
          },
          updatedAt: yield* DateTime.now,
        };
        yield* sink.write({ events: [yield* itemEvent(moved)] });
        return moved.call;
      }
      const project = yield* projects.get(thread.projectId);
      if (
        Option.isNone(project) ||
        project.value.deletedAt !== null ||
        project.value.botRole == null
      ) {
        return yield* new VoiceCallError({ reason: "not-bot" });
      }
      const previous = yield* active();
      if (previous.length > 1 || previous[0]?.call.callId !== input.replacingCallId) {
        return yield* new VoiceCallError({ reason: "active-call-changed" });
      }
      const now = yield* DateTime.now;
      const call: CallItem = {
        id: itemId(input.callId),
        type: "voice_call",
        threadId: input.threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "running",
        title: project.value.title,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        voiceOwner: input.owner,
        voiceWriters: [{ owner: input.owner, ordinalOffset: 0 }],
        call: {
          callId: input.callId,
          ...(input.endpointId === undefined ? {} : { endpointId: input.endpointId }),
          botTitle: project.value.title,
          startedAt: DateTime.formatIso(now),
          endedAt: null,
          endReason: null,
        },
      };
      const events: OrchestrationV2DomainEvent[] = [];
      for (const old of previous) events.push(yield* itemEvent(endedItem(old, now, "replaced")));
      events.push(yield* itemEvent(call));
      yield* sink.write({ events });
      return call.call;
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(storageError),
  );

  const transcriptEvents = Effect.fn("VoiceCalls.transcriptEvents")(function* (
    call: CallItem,
    entries: ReadonlyArray<VoiceTranscriptEntry>,
    owner: string,
  ) {
    const validated = yield* decodeEntries(entries).pipe(
      Effect.mapError(() => new VoiceCallError({ reason: "invalid-entry" })),
    );
    const events: OrchestrationV2DomainEvent[] = [];
    const pending = new Map<string, OrchestrationV2ConversationMessage>();
    const ordinals = new Map<number, string>();
    const offset = call.voiceWriters?.find((writer) => writer.owner === owner)?.ordinalOffset ?? 0;
    for (const source of validated) {
      // A transferred endpoint keeps its own sequence, including late finals.
      // Disjoint ranges preserve order without letting its drain overwrite the new device.
      if (source.ordinal >= 1_000_000)
        return yield* new VoiceCallError({ reason: "invalid-entry" });
      const entry =
        offset === 0
          ? source
          : { ...source, id: `${offset}:${source.id}`, ordinal: offset + source.ordinal };
      const id = messageId(call.call.callId, entry.id);
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM orchestration_v2_projection_messages WHERE message_id = ${id}`;
      const old =
        pending.get(id) ??
        (rows[0] === undefined ? undefined : yield* decodeMessage(rows[0].payload_json));
      if (
        old !== undefined &&
        (old.voiceCall?.ordinal !== entry.ordinal ||
          old.role !== (entry.speaker === "bot" ? "assistant" : "user"))
      ) {
        return yield* new VoiceCallError({ reason: "invalid-entry" });
      }
      if (
        old?.voiceCall !== undefined &&
        (old.voiceCall.revision >= entry.revision || (old.voiceCall.final && !entry.final))
      )
        continue;
      const occupied = yield* sql<{
        message_id: string;
      }>`SELECT message_id FROM orchestration_v2_projection_messages
        WHERE thread_id = ${call.threadId} AND json_extract(payload_json, '$.voiceCall.callId') IS NOT NULL
        AND json_extract(payload_json, '$.voiceCall.callId') = ${call.call.callId}
        AND json_extract(payload_json, '$.voiceCall.ordinal') = ${entry.ordinal} LIMIT 1`;
      if (
        (occupied[0] !== undefined && occupied[0].message_id !== id) ||
        (ordinals.has(entry.ordinal) && ordinals.get(entry.ordinal) !== id)
      ) {
        return yield* new VoiceCallError({ reason: "invalid-entry" });
      }
      const now = yield* DateTime.now;
      const message: OrchestrationV2ConversationMessage = {
        id,
        threadId: call.threadId,
        runId: null,
        nodeId: null,
        role: entry.speaker === "bot" ? "assistant" : "user",
        text: entry.text,
        createdBy: entry.speaker === "bot" ? "agent" : "user",
        creationSource: "provider",
        attachments: [],
        streaming: !entry.final,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        voiceCall: {
          callId: call.call.callId,
          entryId: entry.id,
          ordinal: entry.ordinal,
          revision: entry.revision,
          final: entry.final,
          ...(entry.fragments === undefined ? {} : { fragments: entry.fragments }),
        },
      };
      pending.set(id, message);
      ordinals.set(entry.ordinal, id);
      events.push({
        id: EventId.make(yield* crypto.randomUUIDv4()),
        type: "message.updated",
        threadId: call.threadId,
        occurredAt: now,
        payload: message,
      });
    }
    return events;
  }, Effect.mapError(storageError));

  const append = Effect.fn("VoiceCalls.append")(
    function* (input: OwnedCall & { readonly entries: ReadonlyArray<VoiceTranscriptEntry> }) {
      const call = yield* owned(input);
      if (call.call.endedAt !== null) return yield* new VoiceCallError({ reason: "ended" });
      const events = yield* transcriptEvents(call, input.entries, input.owner);
      if (events.length > 0) yield* sink.write({ events });
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(storageError),
  );

  const end = Effect.fn("VoiceCalls.end")(
    function* (
      input: OwnedCall & {
        readonly reason: VoiceCallEndReason;
        readonly entries?: ReadonlyArray<VoiceTranscriptEntry> | undefined;
      },
    ) {
      yield* requireThread(input.threadId);
      const call = yield* read(input.callId);
      if (call === null || call.threadId !== input.threadId)
        return yield* new VoiceCallError({ reason: "not-found" });
      if (
        call.voiceOwner !== input.owner &&
        !call.voiceWriters?.some((writer) => writer.owner === input.owner)
      )
        return yield* new VoiceCallError({ reason: "owner-changed" });
      const events = yield* transcriptEvents(call, input.entries ?? [], input.owner);
      // Old endpoints may drain their segment but cannot end the current device's call.
      if (call.call.endedAt === null && call.voiceOwner === input.owner) {
        events.push(yield* itemEvent(endedItem(call, yield* DateTime.now, input.reason)));
      }
      if (events.length > 0) yield* sink.write({ events });
    },
    (effect) => lock.withPermits(1)(effect),
    Effect.mapError(storageError),
  );

  const transcript = Effect.fn("VoiceCalls.transcript")(function* (
    input: VoiceTranscriptPageInput,
  ) {
    yield* requireThread(input.threadId);
    const call = yield* read(input.callId);
    if (call === null || call.threadId !== input.threadId)
      return yield* new VoiceCallError({ reason: "not-found" });
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM orchestration_v2_projection_messages
      WHERE thread_id = ${input.threadId} AND json_extract(payload_json, '$.voiceCall.callId') IS NOT NULL
        AND json_extract(payload_json, '$.voiceCall.callId') = ${input.callId}
        AND json_extract(payload_json, '$.voiceCall.ordinal') > ${input.afterOrdinal ?? -1}
      ORDER BY json_extract(payload_json, '$.voiceCall.ordinal') LIMIT 65`;
    const entries = yield* Effect.forEach(rows.slice(0, 64), (row) =>
      decodeMessage(row.payload_json).pipe(
        Effect.map((message) => ({
          id: message.voiceCall!.entryId,
          speaker: message.role === "assistant" ? ("bot" as const) : ("user" as const),
          text: message.text,
          ordinal: message.voiceCall!.ordinal,
          revision: message.voiceCall!.revision,
          final: message.voiceCall!.final,
          ...(message.voiceCall!.fragments === undefined
            ? {}
            : { fragments: message.voiceCall!.fragments }),
        })),
      ),
    );
    return { entries, nextOrdinal: rows.length > 64 ? entries.at(-1)!.ordinal : null };
  }, Effect.mapError(storageError));

  // A server restart cannot recover client microphone ownership. Keep the
  // transcript, close its old card, and let the next client explicitly call again.
  const abandoned = yield* active();
  if (abandoned.length > 0) {
    const now = yield* DateTime.now;
    const events = yield* Effect.forEach(abandoned, (call) =>
      itemEvent(endedItem(call, now, "interrupted")),
    );
    yield* sink.write({ events }).pipe(Effect.mapError(storageError));
  }
  const activeCall = Effect.fn("VoiceCalls.activeCall")(function* () {
    const call = (yield* active())[0];
    return call === undefined ? null : { threadId: call.threadId, call: call.call };
  });
  return VoiceCalls.of({ begin, append, end, transcript, active: activeCall, authorize });
});

export const layer = Layer.effect(VoiceCalls, make);
