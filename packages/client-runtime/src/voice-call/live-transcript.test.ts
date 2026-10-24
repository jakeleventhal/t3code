import { describe, expect, it } from "vite-plus/test";
import { VoiceTranscriptEntry } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { LiveTranscript } from "./live-transcript.ts";
import type { LiveTranscriptFragment } from "./live-session.ts";

const decodeEntry = Schema.decodeUnknownSync(VoiceTranscriptEntry);
const isEntry = Schema.is(VoiceTranscriptEntry);

const part = (
  id: string,
  text: string,
  startMs: number,
  speaker: "user" | "bot" = "user",
): LiveTranscriptFragment => ({ id, text, startMs, endMs: startMs + 100, speaker });

describe("Live transcript blocks", () => {
  it("preserves spaces, repeated words and full duplex speech independently", () => {
    const transcript = new LiveTranscript();
    const user = transcript.append(part("u1", "I I", 100))!;
    const bot = transcript.append(part("b1", "Sure", 200, "bot"))!;
    const more = transcript.append(part("u2", " want that", 300))!;
    expect(more.text).toBe("I I want that");
    expect(more.id).toBe(user.id);
    expect(more.ordinal).toBe(0);
    expect(bot.ordinal).toBe(1);
    expect(more.revision).toBe(1);
    expect(more.fragments).toEqual([
      { id: "u1", text: "I I", startMs: 100, endMs: 200 },
      { id: "u2", text: " want that", startMs: 300, endMs: 400 },
    ]);
    expect(decodeEntry(more)).toEqual(more);
    expect(transcript.append(part("u2", " want that", 300))).toBeNull();
  });

  it("uses provider timing for late text without rewriting a block identity or dropping words", () => {
    const transcript = new LiveTranscript();
    transcript.append(part("one", "Hello", 100));
    transcript.append(part("three", "!", 500));
    const later = transcript.append(part("later", "Another sentence", 10_000))!;
    const corrected = transcript.append(part("two", " there", 300))!;
    expect(corrected).toMatchObject({ id: "one", ordinal: 0, revision: 2, text: "Hello there!" });
    expect(later).toMatchObject({ ordinal: 1, text: "Another sentence" });
  });

  it("bounds fragment counts and text per update while keeping the complete transcript", () => {
    const transcript = new LiveTranscript();
    const saved = new Map<string, ReturnType<LiveTranscript["append"]>>();
    for (let n = 0; n < 130; n++) {
      const entry = transcript.append(part(`id-${n}`, " word", n * 100))!;
      saved.set(entry.id, entry);
      expect(entry.fragments!.length).toBeLessThanOrEqual(64);
    }
    expect([...saved.values()].map((entry) => entry!.text).join("")).toBe(" word".repeat(130));
    expect(saved.size).toBe(3);
    const large = transcript.append(part("large", "a".repeat(4096), 20_000))!;
    const next = transcript.append(part("next", "b", 20_100))!;
    expect(next.id).not.toBe(large.id);
    expect(isEntry({ ...next, text: "changed" })).toBe(false);
  });
});
