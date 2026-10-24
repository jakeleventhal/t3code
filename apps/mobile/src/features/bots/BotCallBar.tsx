import type { VoiceCallState } from "@t3tools/client-runtime/voice-call";
import { ProjectId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { useProject } from "../../state/entities";
import { BotAvatar } from "./BotAvatar";
import { botCallCanToggleMute, botCallPhaseLabel, type BotCallControls } from "./bot-call";
import { BotCallTranscriptSheet } from "./BotCallTranscriptSheet";

/**
 * The compact control for the one live call: who, a status word, and the controls. It never
 * shows what was said; the transcript exists only in the sheet the user opens, and the
 * `transcript` and `composer` slots mount only then, so a collapsed call never re-renders on
 * speech or typing. Pass a null `composer` when the call cannot take typed messages.
 */
export function BotCallBar(props: {
  readonly call: VoiceCallState;
  readonly controls: BotCallControls;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly transcript: ReactNode;
  readonly composer: ReactNode;
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
    <View className="flex-row items-center gap-0.5 rounded-full border border-border bg-card py-0.5 ps-2 pe-0.5">
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
        <Text
          className={cn("text-xs", failed ? "text-danger-foreground" : "text-foreground-muted")}
          numberOfLines={1}
        >
          {status}
        </Text>
      </View>
      <IconButton
        accessibilityLabel={call.muted ? "Unmute" : "Mute"}
        icon={call.muted ? "mic.slash" : "mic"}
        variant="tonal"
        selected={call.muted}
        disabled={!botCallCanToggleMute(call.phase)}
        onPress={() => controls.toggleMute(call.callId)}
      />
      <IconButton
        accessibilityLabel="Show transcript"
        icon="chevron.up"
        onPress={() => props.onExpandedChange(true)}
      />
      <IconButton
        accessibilityLabel="Open chat"
        icon="arrow.up.left.and.arrow.down.right"
        onPress={() => controls.openChat(call)}
      />
      <IconButton
        accessibilityLabel={failed ? "Dismiss" : "End call"}
        icon="phone.down"
        variant="danger"
        onPress={() => controls.end(call.callId)}
      />
      {props.expanded ? (
        <BotCallTranscriptSheet
          botTitle={title}
          onClose={() => props.onExpandedChange(false)}
          onOpenChat={() => controls.openChat(call)}
          transcript={props.transcript}
          composer={props.composer}
        />
      ) : null}
    </View>
  );
}
