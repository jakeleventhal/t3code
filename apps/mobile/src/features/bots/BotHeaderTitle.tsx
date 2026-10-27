import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Pressable, View } from "react-native";

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
