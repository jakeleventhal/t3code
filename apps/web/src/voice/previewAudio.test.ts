import { afterEach, expect, it, vi } from "vite-plus/test";
import { playPreviewAudio, previewAudioBlob } from "./previewAudio";

afterEach(() => vi.unstubAllGlobals());

it("retains the audio bytes and MIME type for CSP-compatible blob playback", async () => {
  const blob = previewAudioBlob("data:audio/mpeg;base64,SUQzAAH/");
  expect(blob.type).toBe("audio/mpeg");
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([73, 68, 51, 0, 1, 255]);
  expect(() => previewAudioBlob("https://example.com/sample")).toThrow("invalid audio");
});

it.each(["ended", "error", "abort"] as const)("releases the media URL after %s", async (ending) => {
  const media = Object.assign(new EventTarget(), {
    src: "",
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  });
  const source = vi.spyOn(URL, "createObjectURL");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  vi.stubGlobal("Audio", function AudioMock(uri: string) {
    media.src = uri;
    return media;
  });
  const abort = new AbortController();
  const playing = playPreviewAudio("data:audio/mpeg;base64,SUQzAAH/", abort.signal);
  expect(media.src).toMatch(/^blob:/);
  const url = media.src;
  if (ending === "ended") media.dispatchEvent(new Event("ended"));
  else if (ending === "error") media.dispatchEvent(new Event("error"));
  else abort.abort();
  if (ending === "error") await expect(playing).rejects.toThrow("decoded");
  else await playing;
  expect(revoke).toHaveBeenCalledWith(url);
  expect(media.src).toBe("");
  source.mockRestore();
  revoke.mockRestore();
});
