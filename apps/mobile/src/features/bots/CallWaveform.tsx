import {
  CALL_WAVEFORM_GAINS,
  CALL_WAVEFORM_IDLE,
  callWaveformScales,
} from "@t3tools/client-runtime/voice-call/audio-levels";
import { memo, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { callAudioLevels } from "../../voice/callAudioLevels";

const LEVEL_TIMING = { duration: 90, reduceMotion: ReduceMotion.System } as const;
const WAVEFORM_HEIGHT = 16;

const WaveformBar = memo(function WaveformBar(props: { readonly scale: SharedValue<number> }) {
  const { scale } = props;
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));
  return (
    <Animated.View
      className="w-[3px] rounded-full bg-emerald-500"
      style={[{ height: WAVEFORM_HEIGHT }, animatedStyle]}
    />
  );
});

/**
 * The call's measured microphone and reply loudness as four bars. Samples drive shared values on
 * the UI thread, so the bar never re-renders per sample; sampling stops while the call has no live
 * audio, the app is in the background, or motion is reduced, and the bars rest flat.
 */
export function CallWaveform(props: { readonly live: boolean }) {
  const reducedMotion = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const first = useSharedValue(CALL_WAVEFORM_IDLE);
  const second = useSharedValue(CALL_WAVEFORM_IDLE);
  const third = useSharedValue(CALL_WAVEFORM_IDLE);
  const fourth = useSharedValue(CALL_WAVEFORM_IDLE);

  // oxlint-disable-next-line t3code/react-effect-budget -- Follow app foreground state so sampling stops in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  // oxlint-disable-next-line t3code/react-effect-budget -- Subscribe the visible bars to the live call's level samples.
  useEffect(() => {
    if (!props.live || !foreground || reducedMotion) return;
    const bars = [first, second, third, fourth];
    const apply = (scales: ReadonlyArray<number>) => {
      bars.forEach((bar, index) => {
        bar.value = withTiming(scales[index] ?? CALL_WAVEFORM_IDLE, LEVEL_TIMING);
      });
    };
    const unsubscribe = callAudioLevels.subscribe((levels) => apply(callWaveformScales(levels)));
    return () => {
      unsubscribe();
      apply([]);
    };
  }, [props.live, foreground, reducedMotion, first, second, third, fourth]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center gap-[3px]"
      style={{ height: WAVEFORM_HEIGHT }}
    >
      {[first, second, third, fourth].map((scale, index) => (
        <WaveformBar key={CALL_WAVEFORM_GAINS[index]} scale={scale} />
      ))}
    </View>
  );
}
