import type { VoiceCallState } from "@t3tools/client-runtime/voice-call";
import { ProjectId } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { useProject } from "../../state/entities";
import { BotAvatar } from "./BotAvatar";
import { botCallCanToggleMute, botCallPhaseLabel, type BotCallControls } from "./bot-call";

export function BotCallBar(props: {
  readonly call: VoiceCallState;
  readonly controls: BotCallControls;
}) {
  const { call, controls } = props;
  // The call keeps the name it started with; the live project shows a rename or new picture.
  const project = useProject({
    environmentId: call.threadRef.environmentId,
    projectId: ProjectId.make(call.bot.id),
  });
  const title = project?.title ?? call.bot.title;
  const failed = call.phase === "failed";
  const status =
    (failed || call.phase === "reconnecting") && call.error
      ? call.error
      : botCallPhaseLabel(call.phase, call.muted);
  return (
    <View className="gap-2 rounded-3xl border border-border bg-card p-2">
      <View className="flex-row items-center gap-0.5">
        <BotAvatar
          role={call.bot.botRole ?? "specialist"}
          title={title}
          size={30}
          project={project}
        />
        <View
          accessible
          accessibilityLabel={`Call with ${title}`}
          accessibilityValue={{ text: status }}
          className="min-w-0 flex-1 px-1.5"
        >
          <Text className="font-t3-medium text-sm text-foreground" numberOfLines={1}>
            {title}
          </Text>
        </View>
        <IconButton
          accessibilityLabel={call.muted ? "Unmute" : "Mute"}
          icon={call.muted ? "mic.slash" : "mic"}
          variant="standard"
          selected={call.muted}
          disabled={!botCallCanToggleMute(call.phase)}
          onPress={() => controls.toggleMute(call.callId)}
        />
        <IconButton
          accessibilityLabel="Open chat"
          icon="viewfinder"
          onPress={() => controls.openChat(call)}
        />
        <IconButton
          accessibilityLabel={failed ? "Dismiss" : "End call"}
          icon="phone.down"
          variant="danger"
          onPress={() => controls.end(call.callId)}
        />
      </View>
      <Text
        className={cn("px-2 text-sm", failed ? "text-danger-foreground" : "text-foreground-muted")}
        accessibilityLiveRegion="polite"
      >
        {status}
      </Text>
    </View>
  );
}
