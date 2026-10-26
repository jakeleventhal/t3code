import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  View,
  useAnimatedValue,
} from "react-native";

export function TypingDots() {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [reduced, setReduced] = useState(true);
  const phase = useAnimatedValue(0);
  useEffect(() => {
    const app = AppState.addEventListener("change", (state) => setActive(state === "active"));
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    return () => {
      app.remove();
      motion.remove();
    };
  }, []);
  useEffect(() => {
    phase.setValue(0);
    if (!focused || !active || reduced) return;
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [focused, active, reduced, phase]);
  return (
    <View
      className="flex-row items-center gap-1"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map((dot) => (
        <Animated.View
          key={dot}
          className="size-1.5 rounded-full bg-foreground-muted"
          style={{
            opacity: reduced
              ? 0.6
              : phase.interpolate({
                  inputRange: [0, 0.1 + dot * 0.12, 0.3 + dot * 0.12, 0.5 + dot * 0.12, 1],
                  outputRange: [0.3, 0.3, 1, 0.3, 0.3],
                }),
          }}
        />
      ))}
    </View>
  );
}
