import {
  ThreadId,
  type VoiceTranscriptEntry,
  type VoiceTranscriptPage,
  type VoiceTranscriptPageInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  formatVoiceCallDuration,
  mergeVoiceTranscriptPages,
  readVoiceTranscriptPages,
  voiceCallStatusLabel,
  voiceTranscriptPagesToRefresh,
} from "./voiceCall.ts";

const threadId = ThreadId.make("thread-1");
type PageResult = AsyncResult.AsyncResult<VoiceTranscriptPage, string>;

function entry(
  ordinal: number,
  overrides: Partial<VoiceTranscriptEntry> = {},
): VoiceTranscriptEntry {
  return {
    id: `entry-${ordinal}`,
    speaker: ordinal % 2 === 0 ? "user" : "bot",
    text: `line ${ordinal}`,
    ordinal,
    revision: 0,
    final: true,
    ...overrides,
  };
}

function page(ordinals: number[], nextOrdinal: number | null): PageResult {
  return AsyncResult.success({ entries: ordinals.map((ordinal) => entry(ordinal)), nextOrdinal });
}

/** Answers each cursor from `results`, recording which cursors were asked for. */
function reader(results: Record<string, PageResult>) {
  const requested: Array<number | undefined> = [];
  const read = (input: VoiceTranscriptPageInput): PageResult => {
    requested.push(input.afterOrdinal);
    return results[String(input.afterOrdinal ?? "start")] ?? AsyncResult.initial(true);
  };
  return { read, requested };
}

describe("readVoiceTranscriptPages", () => {
  it("follows each page's cursor and never reads past the requested page count", () => {
    const { read, requested } = reader({
      start: page([0, 1], 2),
      "2": page([2, 3], 4),
      "4": page([4], null),
    });
    readVoiceTranscriptPages({ threadId, callId: "call-1", pageCount: 2 }, read);
    expect(requested).toEqual([undefined, 2]);
  });

  it("stops at a page that has not loaded, since it names where the next one starts", () => {
    const { read, requested } = reader({ start: AsyncResult.initial(true) });
    readVoiceTranscriptPages({ threadId, callId: "call-1", pageCount: 3 }, read);
    expect(requested).toEqual([undefined]);
  });

  it("stops at the end of the transcript even when more pages were allowed", () => {
    const { read, requested } = reader({ start: page([0], null) });
    const pages = readVoiceTranscriptPages({ threadId, callId: "call-1", pageCount: 3 }, read);
    expect(requested).toEqual([undefined]);
    expect(mergeVoiceTranscriptPages(pages)).toMatchObject({ status: "ready", complete: true });
  });
});

describe("mergeVoiceTranscriptPages", () => {
  it("keeps loaded pages and retries only the page that failed", () => {
    const { read } = reader({
      start: page([0, 1], 2),
      "2": AsyncResult.failure(Cause.fail("offline")),
    });
    const history = mergeVoiceTranscriptPages(
      readVoiceTranscriptPages({ threadId, callId: "call-1", pageCount: 2 }, read),
    );
    expect(history.entries.map((line) => line.ordinal)).toEqual([0, 1]);
    expect(history).toMatchObject({
      status: "error",
      complete: false,
      retry: { threadId, callId: "call-1", afterOrdinal: 2 },
    });
  });

  it("keeps a failed page's last rows but still offers retry and reads no further", () => {
    const stale = AsyncResult.success<VoiceTranscriptPage, string>({
      entries: [entry(0), entry(1)],
      nextOrdinal: 2,
    });
    const { read, requested } = reader({
      start: AsyncResult.failure(Cause.fail("offline"), { previousSuccess: Option.some(stale) }),
      "2": page([2], null),
    });
    const history = mergeVoiceTranscriptPages(
      readVoiceTranscriptPages({ threadId, callId: "call-1", pageCount: 2 }, read),
    );
    expect(requested).toEqual([undefined]);
    expect(history.entries.map((line) => line.ordinal)).toEqual([0, 1]);
    expect(history).toMatchObject({
      status: "error",
      complete: false,
      retry: { threadId, callId: "call-1" },
    });

    const retrying = mergeVoiceTranscriptPages([
      {
        input: { threadId, callId: "call-1" },
        result: AsyncResult.failure(Cause.fail("offline"), {
          previousSuccess: Option.some(stale),
          waiting: true,
        }),
      },
    ]);
    expect(retrying.status).toBe("loading");
    expect(retrying.entries).toHaveLength(2);
  });

  it("shows earlier pages while the next one loads, and offers more until the end", () => {
    const loading = mergeVoiceTranscriptPages(
      readVoiceTranscriptPages(
        { threadId, callId: "call-1", pageCount: 2 },
        reader({ start: page([0, 1], 2) }).read,
      ),
    );
    expect(loading).toMatchObject({ status: "loading", complete: false });
    expect(loading.entries).toHaveLength(2);

    const more = mergeVoiceTranscriptPages(
      readVoiceTranscriptPages(
        { threadId, callId: "call-1", pageCount: 1 },
        reader({ start: page([0, 1], 2) }).read,
      ),
    );
    expect(more).toMatchObject({ status: "ready", complete: false });
  });

  it("shows one line per entry at its newest revision when pages overlap", () => {
    const { read } = reader({
      start: AsyncResult.success({
        entries: [entry(0), entry(1, { text: "draft", revision: 0, final: false })],
        nextOrdinal: 1,
      }),
      "1": AsyncResult.success({
        entries: [entry(1, { text: "final words", revision: 2 }), entry(2)],
        nextOrdinal: null,
      }),
    });
    const history = mergeVoiceTranscriptPages(
      readVoiceTranscriptPages({ threadId, callId: "call-1", pageCount: 2 }, read),
    );
    expect(history.entries.map((line) => line.text)).toEqual(["line 0", "final words", "line 2"]);
  });
});

describe("voiceTranscriptPagesToRefresh", () => {
  const cached = readVoiceTranscriptPages(
    { threadId, callId: "call-1", pageCount: 2 },
    reader({ start: page([0, 1], 2), "2": page([2], null) }).read,
  );

  it("re-reads every cached page when the card opens, so words finalized later appear", () => {
    expect(voiceTranscriptPagesToRefresh(cached, "open").map((it) => it.afterOrdinal)).toEqual([
      undefined,
      2,
    ]);
  });

  it("leaves a first read in flight alone on open, so an uncached open asks once", () => {
    const first = readVoiceTranscriptPages(
      { threadId, callId: "call-1", pageCount: 1 },
      reader({}).read,
    );
    expect(voiceTranscriptPagesToRefresh(first, "open")).toEqual([]);
  });

  it("re-reads even a page in flight when the call ends, since it may predate the end", () => {
    const inFlight = readVoiceTranscriptPages(
      { threadId, callId: "call-1", pageCount: 2 },
      reader({ start: page([0, 1], 2) }).read,
    );
    expect(voiceTranscriptPagesToRefresh(inFlight, "end").map((it) => it.afterOrdinal)).toEqual([
      undefined,
      2,
    ]);
  });
});

describe("call status", () => {
  it("formats minutes and hours, and refuses impossible ranges", () => {
    expect(formatVoiceCallDuration("2026-10-23T10:00:00Z", "2026-10-23T10:04:05Z")).toBe("4:05");
    expect(formatVoiceCallDuration("2026-10-23T10:00:00Z", "2026-10-23T11:02:03Z")).toBe("1:02:03");
    expect(formatVoiceCallDuration("2026-10-23T10:00:00Z", "2026-10-23T09:00:00Z")).toBeNull();
    expect(formatVoiceCallDuration("nope", "2026-10-23T09:00:00Z")).toBeNull();
  });

  it("shows a running call as ongoing and an ended one by length and how it ended", () => {
    const call = { callId: "call-1", botTitle: "Fitness", startedAt: "2026-10-23T10:00:00Z" };
    expect(voiceCallStatusLabel({ ...call, endedAt: null, endReason: null })).toBe("Ongoing");
    expect(
      voiceCallStatusLabel({ ...call, endedAt: "2026-10-23T10:04:05Z", endReason: "user" }),
    ).toBe("4:05");
    expect(
      voiceCallStatusLabel({ ...call, endedAt: "2026-10-23T10:04:05Z", endReason: "interrupted" }),
    ).toBe("4:05 · Interrupted");
  });
});
