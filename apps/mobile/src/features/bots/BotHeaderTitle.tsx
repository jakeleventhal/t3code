import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNativeLayoutMetrics } from "../../native/native-layout-metrics";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

import { AppText as Text } from "../../components/ui/AppText";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { botName, botRole } from "./bot-room";
import { BotAvatar } from "./BotAvatar";

export interface BotChatIdentity {
  readonly project: EnvironmentProject;
  /** The topic's title, or null in the bot's main chat. */
  readonly topic: string | null;
  readonly onPress: () => void;
}

export const BOT_CHAT_HEADER_HEIGHT = 112;

export function useBotHeaderTopInset() {
  const insets = useSafeAreaInsets();
  const metrics = useNativeLayoutMetrics();
  const { layout } = useAdaptiveWorkspaceLayout();
  // The transparent native bar is included in the screen's safe area, but the avatar overlays it.
  return Platform.OS === "ios" && !layout.usesSplitView
    ? (metrics?.safeArea.top ?? insets.top)
    : insets.top;
}

export function BotHeaderTitle(props: BotChatIdentity & { readonly maxWidth: number }) {
  const { project } = props;
  const role = botRole(project) ?? "specialist";
  const name = botName(project);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.topic ? `${name}, ${props.topic}` : name}
      accessibilityHint="Opens this bot's profile"
      hitSlop={6}
      onPress={props.onPress}
      className="items-center active:opacity-70"
      style={{ maxWidth: props.maxWidth }}
    >
      <BotAvatar role={role} title={name} size={68} project={project} live />
      <GlassSurface style={{ borderRadius: 24, marginTop: -2, maxWidth: props.maxWidth }}>
        <View className="px-4 py-1.5">
          <Text
            className="font-t3-semibold text-foreground"
            style={{ fontSize: 16 }}
            numberOfLines={1}
          >
            {name}
          </Text>
        </View>
      </GlassSurface>
    </Pressable>
  );
}
