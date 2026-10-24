import type { VoiceTranscriptFragment } from "@t3tools/contracts";

import type { VoiceCallTranscriptEntry } from "./controller.ts";
import type { LiveTranscriptFragment } from "./live-session.ts";

const MAX_BLOCK_TEXT = 4096;
const MAX_BLOCK_FRAGMENTS = 64;
const BLOCK_GAP_MS = 1000;
const MAX_BLOCK_DURATION_MS = 30_000;

interface Block {
  entry: VoiceCallTranscriptEntry;
  start: number;
  end: number;
  fragments: ReadonlyArray<VoiceTranscriptFragment>;
}

/** Display blocks are not speech turns or playback acknowledgments. Keep the source timing. */
export class LiveTranscript {
  private readonly blocks: Record<"user" | "bot", Block[]> = { user: [], bot: [] };
  private readonly seen = new Set<string>();
  private ordinal = 0;
  private readonly untimed = new Map<string, VoiceCallTranscriptEntry>();

  appendUntimed(input: {
    readonly id: string;
    readonly speaker: "user" | "bot";
    readonly text: string;
    readonly final: boolean;
  }): VoiceCallTranscriptEntry | null {
    const old = this.untimed.get(input.id);
    if (old?.text === input.text && old.final === input.final) return null;
    const entry = {
      ...input,
      ordinal: old?.ordinal ?? this.ordinal++,
      revision: (old?.revision ?? -1) + 1,
    };
    this.untimed.set(input.id, entry);
    return entry;
  }

  appendTyped(id: string, text: string): VoiceCallTranscriptEntry | null {
    if (this.seen.has(id)) return null;
    this.seen.add(id);
    // Typed input has no provider audio interval. Keep it as its own history item.
    return { id, speaker: "user", text, final: true, revision: 0, ordinal: this.ordinal++ };
  }

  append(fragment: LiveTranscriptFragment): VoiceCallTranscriptEntry | null {
    if (this.seen.has(fragment.id)) return null;
    this.seen.add(fragment.id);
    const candidates = this.blocks[fragment.speaker];
    const block = candidates.findLast(
      (candidate) =>
        candidate.fragments.length < MAX_BLOCK_FRAGMENTS &&
        candidate.entry.text.length + fragment.text.length <= MAX_BLOCK_TEXT &&
        fragment.startMs <= candidate.end + BLOCK_GAP_MS &&
        fragment.endMs >= candidate.start - BLOCK_GAP_MS &&
        Math.max(fragment.endMs, candidate.end) - Math.min(fragment.startMs, candidate.start) <=
          MAX_BLOCK_DURATION_MS,
    );
    const source: VoiceTranscriptFragment = {
      id: fragment.id,
      text: fragment.text,
      startMs: fragment.startMs,
      endMs: fragment.endMs,
    };
    if (block !== undefined) {
      // Stable sort retains provider order when two intervals have the same start time.
      block.fragments = [...block.fragments, source].sort((a, b) => a.startMs - b.startMs);
      block.start = Math.min(block.start, fragment.startMs);
      block.end = Math.max(block.end, fragment.endMs);
      block.entry = {
        ...block.entry,
        text: block.fragments.map((part) => part.text).join(""),
        fragments: block.fragments,
        revision: block.entry.revision + 1,
      };
      return block.entry;
    }
    const entry: VoiceCallTranscriptEntry = {
      id: fragment.id,
      speaker: fragment.speaker,
      text: fragment.text,
      fragments: [source],
      // Live deltas are stable text. This flag does not claim that a turn or playback ended.
      final: true,
      revision: 0,
      ordinal: this.ordinal++,
    };
    candidates.push({ entry, fragments: [source], start: fragment.startMs, end: fragment.endMs });
    return entry;
  }
}
