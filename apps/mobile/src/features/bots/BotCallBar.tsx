import type { VoiceCallState } from "@t3tools/client-runtime/voice-call";
import { ProjectId } from "@t3tools/contracts";
import { View } from "react-native";
import { useSyncExternalStore } from "react";
import { secondTick } from "@t3tools/client-runtime/clock";
import { formatVoiceCallDuration } from "@t3tools/client-runtime/work-log/voice-call";
import { useAppActive } from "../../lib/appState";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { useProject } from "../../state/entities";
import { BotAvatar } from "./BotAvatar";
import { CallWaveform } from "./CallWaveform";
import { botCallCanToggleMute, botCallPhaseLabel, type BotCallControls } from "./bot-call";

/**
 * The live call as one capsule: who, what the call is doing, its measured audio, and the
 * controls. In the call's own chat there is nothing to open, so that control drops out.
 */
export function BotCallBar(props: {
  readonly call: VoiceCallState;
  readonly controls: BotCallControls;
  readonly inChat: boolean;
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
  const live = botCallCanToggleMute(call.phase);
  return (
    <View
      className={cn(
        "min-h-14 flex-row items-center gap-2 rounded-[28px] border bg-card py-1 pl-3.5 pr-1",
        failed ? "border-danger-border" : "border-border",
      )}
    >
      <View
        className={cn("size-[7px] rounded-full", failed ? "bg-danger" : "bg-emerald-500")}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
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
        className="min-w-0 flex-1"
      >
        <Text textRole="footnote" className="font-t3-semibold text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Text
          textRole="label"
          className={failed ? "text-danger-foreground" : "text-foreground-muted"}
          numberOfLines={failed ? 3 : 1}
          accessibilityLiveRegion="polite"
        >
          {status}
        </Text>
      </View>
      {!failed && call.connectedAt != null ? <CallElapsed connectedAt={call.connectedAt} /> : null}
      {failed ? null : <CallWaveform live={live} />}
      <View className="flex-row items-center">
        <IconButton
          accessibilityLabel={call.muted ? "Unmute" : "Mute"}
          icon={call.muted ? "mic.slash" : "mic"}
          variant="standard"
          selected={call.muted}
          disabled={!live}
          onPress={() => controls.toggleMute(call.callId)}
        />
        {props.inChat ? null : (
          <IconButton
            accessibilityLabel="Open chat"
            icon="viewfinder"
            onPress={() => controls.openChat(call)}
          />
        )}
        <IconButton
          accessibilityLabel={failed ? "Dismiss" : "End call"}
          icon="phone.down"
          variant="danger"
          onPress={() => controls.end(call.callId)}
        />
      </View>
    </View>
  );
}

const noTick = () => () => {};

function CallElapsed({ connectedAt }: { readonly connectedAt: number }) {
  const active = useAppActive();
  const now = useSyncExternalStore(active ? secondTick.subscribe : noTick, secondTick.getSnapshot);
  return (
    <Text textRole="label" className="text-foreground-muted" accessibilityLabel="Call duration">
      {formatVoiceCallDuration(new Date(connectedAt).toISOString(), new Date(now).toISOString())}
    </Text>
  );
}
