// @effect-diagnostics globalTimers:off - Bound audio playback so failed previews release their resources.
import { useEffect, useRef, useState } from "react";
import type { EnvironmentId, VoiceSelection, VoiceConnection } from "@t3tools/contracts";
import { playVoicePreview } from "@t3tools/client-runtime/voice-call/preview";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { botVoiceEnvironment } from "../state/bot-voice";
import { openLiveNativeWebRtc } from "./liveWebRtc";
import { useEnvironmentServerConfig } from "../state/entities";
import { voiceCallController } from "./runtime";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { uuidv4 } from "../lib/uuid";

async function playAudio(uri: string, signal: AbortSignal) {
  await setAudioModeAsync({ playsInSilentMode: true });
  signal.throwIfAborted();
  const file = new File(Paths.cache, `voice-preview-${uuidv4()}.mp3`);
  file.write(Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (char) => char.charCodeAt(0)));
  let player: ReturnType<typeof createAudioPlayer> | undefined;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const audio = createAudioPlayer({ uri: file.uri });
    player = audio;
    await new Promise<void>((resolve, reject) => {
      stop = () => {
        audio.pause();
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      audio.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          resolve();
        }
      });
      timer = setTimeout(() => reject(new Error("The preview audio timed out.")), 20_000);
      if (signal.aborted) stop();
      else audio.play();
    });
  } finally {
    clearTimeout(timer);
    if (stop) signal.removeEventListener("abort", stop);
    player?.remove();
    file.delete();
  }
}

let activePreview: AbortController | null = null;

export function useVoicePreview(environmentId: EnvironmentId) {
  const config = useEnvironmentServerConfig(environmentId);
  const request = useAtomCommand(botVoiceEnvironment.preview, { reportFailure: false });
  const current = useRef<AbortController | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const unsubscribe = voiceCallController.subscribe(() => {
      const call = voiceCallController.getSnapshot();
      if (call && call.phase !== "failed") current.current?.abort();
    });
    return () => {
      unsubscribe();
      current.current?.abort();
    };
  }, []);
  const play = async (selection: VoiceSelection, kind: VoiceConnection["kind"]) => {
    const key = JSON.stringify(selection);
    current.current?.abort();
    if (playing === key) {
      setPlaying(null);
      return;
    }
    const call = voiceCallController.getSnapshot();
    if (call && call.phase !== "failed") {
      setError("End the current call before playing a voice preview.");
      return;
    }
    if (config?.environment.capabilities.botVoicePreview !== true) {
      setError("Update T3 Code on this host to preview its voices.");
      return;
    }
    activePreview?.abort();
    const abort = new AbortController();
    activePreview = abort;
    current.current = abort;
    setPlaying(key);
    setError(null);
    await playVoicePreview({
      selection,
      kind,
      signal: abort.signal,
      openMedia: openLiveNativeWebRtc,
      negotiate: async (input) => {
        const result = await request({ environmentId, input });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        return result.value;
      },
      playAudio,
    })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted)
          setError(
            `Voice preview could not play. ${cause instanceof Error ? cause.message : "Check the voice connection and try again."}`,
          );
      })
      .finally(() => {
        if (activePreview === abort) activePreview = null;
        if (current.current === abort) {
          current.current = null;
          setPlaying(null);
        }
      });
  };
  return { play, playing, error };
}
