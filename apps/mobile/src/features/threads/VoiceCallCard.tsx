import { voiceCallStatusLabel } from "@t3tools/client-runtime/work-log/voice-call";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Pressable, View, type ColorValue } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { useVoiceCallTranscript, type VoiceCallTranscriptView } from "../../state/bot-voice";

/**
 * A call in the conversation, collapsed by default. Its words, never audio, load only while
 * open, so collapsed calls cost nothing.
 */
export function VoiceCallCard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly expanded: boolean;
  readonly iconColor: ColorValue;
  readonly onToggle: () => void;
  /** Another page was asked for; the feed holds the reader in place until it lands. */
  readonly onTranscriptPending: () => void;
  readonly onTranscriptSettled: () => void;
}) {
  const { item, sourceThreadId } = props.projectedItem;
  const call = item.type === "voice_call" ? item.call : null;
  const transcript = useVoiceCallTranscript(
    call !== null && props.expanded
      ? {
          environmentId: props.environmentId,
          threadId: sourceThreadId,
          callId: call.callId,
          ended: call.endedAt !== null,
        }
      : null,
  );
  const { onTranscriptSettled } = props;
  const transcriptSettled = props.expanded && transcript.status !== "loading";
  const latestSettled = useRef(onTranscriptSettled);
  // Every commit, not on a status change: a page served from cache lands
  // without the status ever leaving "ready".
  // oxlint-disable-next-line t3code/react-effect-budget -- Notify the virtual list after transcript content has committed and can be measured.
  useLayoutEffect(() => {
    latestSettled.current = onTranscriptSettled;
    if (transcriptSettled) onTranscriptSettled();
  });
  // A card scrolled out of the list can no longer report its page.
  // oxlint-disable-next-line t3code/react-effect-budget -- Release a waiting reveal when its transcript card is virtualized out of the list.
  useEffect(() => () => latestSettled.current(), []);
  if (call === null) return null;
  const title = `Call with ${call.botTitle}`;
  const status = voiceCallStatusLabel(call);
  return (
    <View className="mb-3 overflow-hidden rounded-[18px] border border-border bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: status }}
        accessibilityState={{ expanded: props.expanded }}
        className="min-h-12 flex-row items-center gap-2.5 px-3 py-2 active:bg-subtle"
        onPress={props.onToggle}
      >
        <View className="size-7 items-center justify-center rounded-full bg-emerald-500/15">
          <SymbolView
            name="phone"
            size={12}
            tintColorClassName="accent-emerald-500"
            type="monochrome"
          />
        </View>
        <Text className="shrink font-t3-medium text-sm text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Text className="shrink-0 text-xs text-foreground-muted" numberOfLines={1}>
          {status}
        </Text>
        <View className="flex-1" />
        <SymbolView
          name={props.expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColor={props.iconColor}
          type="monochrome"
        />
      </Pressable>
      {props.expanded ? (
        <View className="border-t border-border">
          <VoiceCallCardTranscript
            transcript={transcript}
            ongoing={call.endedAt === null}
            onRequestPage={props.onTranscriptPending}
          />
        </View>
      ) : null}
    </View>
  );
}

function VoiceCallCardTranscript(props: {
  readonly transcript: VoiceCallTranscriptView;
  readonly ongoing: boolean;
  readonly onRequestPage: () => void;
}) {
  const { transcript, onRequestPage } = props;
  const footer =
    transcript.status === "error" ? (
      <View className="flex-row items-center gap-2 px-3 py-1">
        <Text className="flex-1 text-xs text-danger-foreground" numberOfLines={3}>
          {transcript.error}
        </Text>
        <Button
          label="Retry"
          tone="text"
          onPress={() => {
            onRequestPage();
            transcript.retry();
          }}
        />
      </View>
    ) : transcript.status === "loading" ? (
      <View className="items-center px-3 py-4">
        <AppActivityIndicator size="small" accessibilityLabel="Loading transcript" />
      </View>
    ) : transcript.hasMore ? (
      <View className="items-center px-3">
        <Button
          label="Show more"
          tone="text"
          onPress={() => {
            onRequestPage();
            transcript.loadMore();
          }}
        />
      </View>
    ) : null;
  if (transcript.entries.length === 0) {
    return (
      footer ?? (
        <Text className="px-3 py-4 text-center text-xs text-foreground-muted">
          {props.ongoing ? "Nothing said yet." : "Nothing was said."}
        </Text>
      )
    );
  }
  return (
    <>
      <View className="gap-2 px-3 py-2.5">
        {transcript.entries.map((entry) => (
          <Text
            key={entry.id}
            selectable
            className={cn(
              "text-sm",
              entry.speaker === "user"
                ? "max-w-[90%] self-end rounded-xl bg-subtle px-2.5 py-1.5"
                : "max-w-[95%] self-start",
              entry.final ? "text-foreground" : "text-foreground-muted",
            )}
          >
            {entry.text}
          </Text>
        ))}
      </View>
      {footer}
    </>
  );
}
