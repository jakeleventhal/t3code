import {
  CALL_WAVEFORM_GAINS,
  CALL_WAVEFORM_IDLE,
  callWaveformScales,
} from "@t3tools/client-runtime/voice-call/audio-levels";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { getDocumentActivity, subscribeDocumentActivity } from "../../lib/documentActivity";
import { cn } from "../../lib/utils";
import { callAudioLevels } from "../../voice/callAudioLevels";

const documentVisible = () => getDocumentActivity().visible;

/**
 * The call's measured microphone and reply loudness as four bars. Samples are written straight to
 * the bars, so the call bar never re-renders per sample, and sampling stops whenever the call has
 * no live audio, the window is hidden, or motion is reduced; the bars then rest flat.
 */
export function CallWaveform({ live, className }: { live: boolean; className?: string }) {
  const barsRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = useSyncExternalStore(subscribeDocumentActivity, documentVisible);

  // oxlint-disable-next-line t3code/react-effect-budget -- Subscribe the visible bars to the live call's level samples.
  useEffect(() => {
    if (!live || reducedMotion || !visible) return;
    const apply = (scales: ReadonlyArray<number>) => {
      const bars = barsRef.current?.children ?? [];
      for (let index = 0; index < bars.length; index++) {
        (bars[index] as HTMLElement).style.transform =
          `scaleY(${scales[index] ?? CALL_WAVEFORM_IDLE})`;
      }
    };
    const unsubscribe = callAudioLevels.subscribe((levels) => apply(callWaveformScales(levels)));
    return () => {
      unsubscribe();
      apply([]);
    };
  }, [live, reducedMotion, visible]);

  return (
    <span ref={barsRef} aria-hidden className={cn("flex h-3.5 items-center gap-0.5", className)}>
      {CALL_WAVEFORM_GAINS.map((gain) => (
        <span
          key={gain}
          className="h-full w-0.5 origin-center rounded-full bg-current transition-transform duration-100 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleY(${CALL_WAVEFORM_IDLE})` }}
        />
      ))}
    </span>
  );
}
