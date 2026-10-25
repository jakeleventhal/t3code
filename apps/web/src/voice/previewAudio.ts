// @effect-diagnostics globalTimers:off - Release a finite preview even when media never ends.
export function previewAudioBlob(uri: string): Blob {
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri);
  if (!match) throw new Error("The host returned an invalid audio preview.");
  return new Blob([Uint8Array.from(atob(match[2]!), (character) => character.charCodeAt(0))], {
    type: match[1]!,
  });
}

export async function playPreviewAudio(uri: string, signal: AbortSignal) {
  // Electron permits blob media, but deliberately excludes data URLs from media-src.
  const source = previewAudioBlob(uri);
  const objectUrl = URL.createObjectURL(source);
  const audio = new Audio(objectUrl);
  let stop: (() => void) | undefined;
  let ended: (() => void) | undefined;
  let failed: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      stop = () => {
        audio.pause();
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      ended = resolve;
      failed = () => reject(new Error("The preview audio could not be decoded."));
      audio.addEventListener("ended", ended, { once: true });
      audio.addEventListener("error", failed, { once: true });
      timer = setTimeout(() => reject(new Error("The preview audio timed out.")), 20_000);
      if (signal.aborted) stop();
      else void audio.play().catch(reject);
    });
  } finally {
    clearTimeout(timer);
    if (stop) signal.removeEventListener("abort", stop);
    if (ended) audio.removeEventListener("ended", ended);
    if (failed) audio.removeEventListener("error", failed);
    audio.pause();
    audio.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}
