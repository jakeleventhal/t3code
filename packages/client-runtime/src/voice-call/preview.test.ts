import { describe, expect, it, vi } from "vite-plus/test";
import { playVoicePreview } from "./preview.ts";

const selection = { connectionId: "grok", model: "grok-voice", voice: "ara" };

describe("voice preview", () => {
  it("plays the returned sample without opening microphone or call media", async () => {
    const negotiate = vi.fn(async () => ({
      kind: "audio" as const,
      dataUri: "data:audio/mpeg;base64,AQID",
    }));
    const playAudio = vi.fn(async () => {});
    const openMedia = vi.fn(async () => {
      throw new Error("Unexpected media");
    });
    const signal = new AbortController().signal;
    await playVoicePreview({ selection, kind: "xai-api", signal, negotiate, playAudio, openMedia });
    expect(negotiate).toHaveBeenCalledWith({ selection });
    expect(playAudio).toHaveBeenCalledWith("data:audio/mpeg;base64,AQID", signal);
    expect(openMedia).not.toHaveBeenCalled();
  });

  it("does not play a late preview after cancellation", async () => {
    const abort = new AbortController();
    const playAudio = vi.fn(async () => {});
    await expect(
      playVoicePreview({
        selection,
        kind: "xai-api",
        signal: abort.signal,
        negotiate: async () => {
          abort.abort();
          return { kind: "audio", dataUri: "audio" };
        },
        playAudio,
        openMedia: async () => {
          throw new Error("Unexpected media");
        },
      }),
    ).rejects.toThrow();
    expect(playAudio).not.toHaveBeenCalled();
  });
});
