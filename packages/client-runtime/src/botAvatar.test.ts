import { describe, expect, it } from "vite-plus/test";

import {
  botAvatarClipFor,
  botAvatarComposerPrompt,
  botAvatarClipKind,
  botAvatarShowsLiveClips,
  botAvatarStatusLabel,
  firstEmojiGrapheme,
  isEmojiGrapheme,
  parseBotAvatarPrompt,
} from "./botAvatar.ts";

describe("parseBotAvatarPrompt", () => {
  it("accepts the prefilled phrase with the subject the user typed", () => {
    expect(parseBotAvatarPrompt("Change your avatar to a chubby white cat")).toBe(
      "a chubby white cat",
    );
    expect(parseBotAvatarPrompt("change the avatar into: a brass robot  with   goggles ")).toBe(
      "a brass robot with goggles",
    );
  });

  it("leaves ordinary messages alone, including the bare prefix", () => {
    expect(parseBotAvatarPrompt("Change your avatar to ")).toBeNull();
    expect(parseBotAvatarPrompt("Can you change your avatar later?")).toBeNull();
    expect(parseBotAvatarPrompt("What's the weather")).toBeNull();
  });
});

describe("avatar composer revisions", () => {
  const job = {
    kind: "live" as const,
    status: "awaiting-selection" as const,
    prompt: "a muscular monkey with sunglasses",
    startedAt: "2026-10-26T00:00:00Z",
  };
  it("combines a correction with the current description without starting ordinary chat", () => {
    const prompt = botAvatarComposerPrompt("no clothes and a six pack", job)!;
    expect(prompt).toContain(job.prompt);
    expect(prompt).toContain("no clothes and a six pack");
    const revised = botAvatarComposerPrompt("make the sunglasses blue", { ...job, prompt })!;
    expect(revised).toContain("no clothes and a six pack");
    expect(revised).toContain("make the sunglasses blue");
  });
  it("returns to ordinary messages outside the picker and leaves commands alone", () => {
    expect(botAvatarComposerPrompt("hello", null)).toBeNull();
    expect(botAvatarComposerPrompt("hello", { ...job, status: "animating" })).toBeNull();
    expect(botAvatarComposerPrompt("hello", { ...job, status: "generating-options" })).toBeNull();
    expect(botAvatarComposerPrompt("/compact", job)).toBeNull();
    expect(botAvatarComposerPrompt("  ", job)).toBeNull();
    expect(botAvatarComposerPrompt("Change your avatar to a dog", job)).toBe("a dog");
  });
});

describe("clip selection", () => {
  const clips = { idle: ".avatars/a.mp4", working: ".avatars/b.mp4" } as const;

  it("prefers the call over work and falls back to idle for a missing clip", () => {
    expect(botAvatarClipKind({ working: true, onCall: true })).toBe("call");
    expect(botAvatarClipKind({ working: true, onCall: false })).toBe("working");
    expect(botAvatarClipKind({ working: false, onCall: false })).toBe("idle");
    expect(botAvatarClipFor(clips, "call")).toBe(".avatars/a.mp4");
    expect(botAvatarClipFor(clips, "working")).toBe(".avatars/b.mp4");
    expect(botAvatarClipFor({}, "idle")).toBeNull();
  });

  it("shows clips only while the matching still is the picture", () => {
    const avatar = { version: "v1", clips, job: null, updatedAt: "2026-10-26T00:00:00Z" };
    expect(botAvatarShowsLiveClips({ faviconPath: ".avatars/s.png", botAvatar: avatar })).toBe(
      true,
    );
    expect(
      botAvatarShowsLiveClips({
        faviconPath: ".avatars/s.png",
        projectIcon: { kind: "emoji", emoji: "🐙" },
        botAvatar: avatar,
      }),
    ).toBe(false);
    expect(botAvatarShowsLiveClips({ faviconPath: null, botAvatar: avatar })).toBe(false);
    expect(
      botAvatarShowsLiveClips({
        faviconPath: ".avatars/s.png",
        botAvatar: { ...avatar, clips: {} },
      }),
    ).toBe(false);
  });

  it("labels each step and nothing once settled", () => {
    const base = { version: "v1", clips: {}, updatedAt: "2026-10-26T00:00:00Z" };
    const job = { kind: "live" as const, prompt: "a cat", startedAt: base.updatedAt };
    expect(botAvatarStatusLabel({ ...base, job: { ...job, status: "generating-options" } })).toBe(
      "Generating options",
    );
    expect(botAvatarStatusLabel({ ...base, job: { ...job, status: "animating" } })).toBe(
      "Animating avatar",
    );
    expect(botAvatarStatusLabel({ ...base, job: { ...job, status: "failed" } })).toBe(
      "Couldn’t finish",
    );
    expect(botAvatarStatusLabel({ ...base, job: null })).toBeNull();
    expect(botAvatarStatusLabel(null)).toBeNull();
  });
});

describe("firstEmojiGrapheme", () => {
  it("keeps joined, toned, flagged, and keycap sequences whole", () => {
    expect(firstEmojiGrapheme("👩‍💻 dev")).toBe("👩‍💻");
    expect(firstEmojiGrapheme("🇺🇸🇫🇷")).toBe("🇺🇸");
    expect(firstEmojiGrapheme("👍🏽")).toBe("👍🏽");
    expect(firstEmojiGrapheme("  ❤️  ")).toBe("❤️");
    expect(firstEmojiGrapheme("1️⃣2")).toBe("1️⃣");
    expect(firstEmojiGrapheme("👨‍👩‍👧‍👦!")).toBe("👨‍👩‍👧‍👦");
  });

  it("returns null for blank input and rejects letters", () => {
    expect(firstEmojiGrapheme("   ")).toBeNull();
    expect(isEmojiGrapheme("a")).toBe(false);
    expect(isEmojiGrapheme("🐙")).toBe(true);
    expect(isEmojiGrapheme("🇯🇵")).toBe(true);
    expect(isEmojiGrapheme("✈️")).toBe(true);
  });
});
