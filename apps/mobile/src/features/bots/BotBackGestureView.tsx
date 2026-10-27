import type { ReactNode } from "react";
import {
  I18nManager,
  Platform,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";

export function BotBackGestureView(props: {
  readonly enabled: boolean;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly children: ReactNode;
}) {
  const goBack = useWorkspaceBackNavigation("bots");
  const { layout } = useAdaptiveWorkspaceLayout();
  const { width } = useWindowDimensions();
  const direction = I18nManager.isRTL ? -1 : 1;
  // UIKit does not start its pop gesture when the bot's floating header hides the native bar.
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory.
  const gesture = Gesture.Pan()
    .enabled(props.enabled && Platform.OS === "ios" && !layout.usesSplitView)
    .hitSlop(I18nManager.isRTL ? { right: 0, width: 28 } : { left: 0, width: 28 })
    .activeOffsetX(direction * 16)
    .failOffsetY([-20, 20])
    .runOnJS(true)
    .onEnd((event, success) => {
      const distance = event.translationX * direction;
      if (success && distance >= width * 0.3) {
        goBack();
      }
    });
  return (
    <GestureDetector gesture={gesture}>
      <View className="flex-1" collapsable={false} onLayout={props.onLayout}>
        {props.children}
      </View>
    </GestureDetector>
  );
}
