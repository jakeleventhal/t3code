import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { botName, botRole } from "./bot-room";
import { BotAvatar } from "./BotAvatar";

export interface BotChatIdentity {
  readonly project: EnvironmentProject;
  /** The topic's title, or null in the bot's main chat. */
  readonly topic: string | null;
  readonly onPress: () => void;
}

/** A bot chat's header names the bot, not the thread; tapping it opens the bot's profile. */
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
      className="flex-row items-center gap-2 active:opacity-70"
      style={{ maxWidth: props.maxWidth }}
    >
      <BotAvatar role={role} title={name} size={26} project={project} />
      <View className="min-w-0 shrink">
        <Text className="font-t3-bold text-foreground" style={{ fontSize: 15 }} numberOfLines={1}>
          {name}
        </Text>
        {props.topic ? (
          <Text className="text-foreground-muted" style={{ fontSize: 12 }} numberOfLines={1}>
            {props.topic}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
