import type { VoiceCallDraft } from "@t3tools/client-runtime/voice-call";
import { useRef, type ComponentRef, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { cn } from "../../lib/cn";
import type { BotCallTranscriptLine } from "./bot-call";

/** Mounted only while the user has the transcript open; the slots carry their own subscriptions. */
export function BotCallTranscriptSheet(props: {
  readonly botTitle: string;
  readonly onClose: () => void;
  readonly onOpenChat: () => void;
  readonly transcript: ReactNode;
  readonly composer: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet title={`Call with ${props.botTitle}`} onClose={props.onClose}>
      <KeyboardAvoidingView automaticOffset behavior="padding" className="flex-1">
        <View className="flex-1">{props.transcript}</View>
        <View
          className="gap-1 border-t border-border px-4 pt-2"
          style={{ paddingBottom: Math.max(12, insets.bottom) }}
        >
          {props.composer}
          <Button
            label="Open chat"
            icon="arrow.up.left.and.arrow.down.right"
            tone="text"
            onPress={props.onOpenChat}
          />
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

// Stays pinned to the newest words unless the reader has scrolled up to reread.
const PINNED_SLOP = 24;

/** The words of the live call, oldest first. */
export function BotCallTranscript(props: {
  readonly entries: ReadonlyArray<BotCallTranscriptLine>;
}) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const pinned = useRef(true);
  if (props.entries.length === 0) {
    return (
      <Text className="px-4 py-6 text-center text-sm text-foreground-muted">Nothing said yet.</Text>
    );
  }
  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerClassName="gap-2 px-4 py-3"
      scrollEventThrottle={100}
      onScroll={({ nativeEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        pinned.current =
          contentSize.height - contentOffset.y - layoutMeasurement.height < PINNED_SLOP;
      }}
      onContentSizeChange={() => {
        if (pinned.current) scrollRef.current?.scrollToEnd({ animated: false });
      }}
    >
      {props.entries.map((entry) => (
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
    </ScrollView>
  );
}

/**
 * Types into the live voice session, not a separate thread turn, so typed and spoken input share
 * one exchange. The draft and its sending state belong to the call runtime, so closing the sheet
 * mid-send loses neither.
 */
export function BotCallComposer(props: {
  readonly draft: VoiceCallDraft;
  readonly onDraftChange: (text: string) => void;
  readonly onSendDraft: () => void;
}) {
  const { draft } = props;
  const sendDisabled = draft.sending || draft.text.trim().length === 0;
  const send = () => {
    if (!sendDisabled) props.onSendDraft();
  };
  return (
    <View className="gap-1">
      {draft.error ? (
        <Text
          textRole="footnote"
          className="text-danger-foreground"
          accessibilityLiveRegion="polite"
        >
          {draft.error}
        </Text>
      ) : null}
      <View className="flex-row items-end gap-2">
        {/* Stays editable while sending; the runtime keeps whatever was typed meanwhile. */}
        <TextInput
          className="max-h-32 min-h-11 flex-1 rounded-3xl py-2.5"
          multiline
          value={draft.text}
          onChangeText={props.onDraftChange}
          placeholder="Type instead of talking…"
          accessibilityLabel="Type to the call"
          submitBehavior="submit"
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: sendDisabled, busy: draft.sending }}
          disabled={sendDisabled}
          onPress={send}
          className={cn(
            "size-11 items-center justify-center rounded-full bg-primary",
            sendDisabled && "opacity-40",
          )}
        >
          {draft.sending ? (
            <AppActivityIndicator size="small" />
          ) : (
            <SymbolView name="arrow.up" size={18} tintColorClassName="accent-primary-foreground" />
          )}
        </Pressable>
      </View>
    </View>
  );
}
