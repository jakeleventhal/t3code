import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import { firstEmojiGrapheme, isEmojiGrapheme } from "@t3tools/client-runtime/bot-avatar";
import { renderAssistantCitationsAsText } from "@t3tools/shared/assistantCitations";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { MarkdownSelectionContext } from "../../native/MarkdownSelectionContext";
import { Sheet } from "../../components/ui/Sheet";
import { ListSection } from "../../components/ui/ListSection";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { writeComposerContextClipboard } from "../../lib/composerContextClipboard";
import { uuidv4 } from "../../lib/uuid";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentScope } from "../../state/session";
import type { ThreadFeedMessage } from "../../lib/threadActivity";

const REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮", "🔥", "👀", "🙏", "😢", "💯"];

export function BotMessageActions(props: {
  readonly message: ThreadFeedMessage | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly reaction?: string | undefined;
  readonly onReply?: ((text: string) => void) | undefined;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!props.message) return props.children;
  const show = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(true);
  };
  return (
    <>
      <Pressable
        accessible={false}
        onLongPress={show}
        delayLongPress={350}
        accessibilityActions={[{ name: "longpress", label: "Message actions" }]}
        onAccessibilityAction={show}
      >
        <MarkdownSelectionContext value={false}>{props.children}</MarkdownSelectionContext>
      </Pressable>
      {props.reaction ? (
        <Pressable
          onPress={show}
          accessibilityLabel={`Your reaction ${props.reaction}. Change reaction`}
          className={
            props.message.role === "user"
              ? "-mt-2 mb-2 self-end rounded-full bg-subtle px-2 py-1"
              : "-mt-2 mb-2 self-start rounded-full bg-subtle px-2 py-1"
          }
        >
          <Text className="text-base">{props.reaction}</Text>
        </Pressable>
      ) : null}
      {open ? (
        <MessageActionsSheet {...props} message={props.message} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function MessageActionsSheet(
  props: Omit<Parameters<typeof BotMessageActions>[0], "message"> & {
    readonly message: ThreadFeedMessage;
    readonly onClose: () => void;
  },
) {
  const [custom, setCustom] = useState<string | null>(null);
  const markUnread = useAtomCommand(threadEnvironment.markUnread);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const text = renderAssistantCitationsAsText(resolveUserMessagePresentation(props.message).text);
  const handleReaction = async (emoji: string) => {
    props.onClose();
    try {
      await enqueueThreadOutboxMessage({
        environmentId: props.environmentId,
        threadId: props.threadId,
        messageId: MessageId.make(uuidv4()),
        commandId: CommandId.make(uuidv4()),
        text: props.reaction === emoji ? "Removed reaction" : emoji,
        context: {
          version: 1,
          records: [],
          botReaction: {
            messageId: props.message.id,
            text: text.slice(0, 8192),
            emoji: props.reaction === emoji ? null : emoji,
          },
        },
        attachments: [],
        dispatchMode: "queue",
        createdAt: reactionTimestamp(),
      });
    } catch {
      Dialog.alert("Could not save reaction", "Please try again.");
    }
  };
  return (
    <Sheet title="Message" onClose={props.onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-4 py-4"
      >
        <View className="flex-row flex-wrap">
          {[...REACTIONS, "+"].map((emoji) => (
            <View key={emoji} style={{ width: "16.666%" }} className="items-center py-1.5">
              <Pressable
                disabled={!canOperate}
                accessibilityRole="button"
                accessibilityLabel={emoji === "+" ? "Choose another emoji" : `React ${emoji}`}
                accessibilityState={{ selected: props.reaction === emoji, disabled: !canOperate }}
                className={
                  props.reaction === emoji
                    ? "size-11 items-center justify-center rounded-full border-2 border-primary bg-subtle"
                    : "size-11 items-center justify-center rounded-full bg-subtle"
                }
                onPress={() => (emoji === "+" ? setCustom("") : void handleReaction(emoji))}
              >
                <Text className="text-2xl">{emoji}</Text>
              </Pressable>
            </View>
          ))}
        </View>
        {custom !== null ? (
          <View className="flex-row items-center gap-3">
            <TextInput
              autoFocus
              accessibilityLabel="Custom reaction emoji"
              value={custom}
              onChangeText={setCustom}
              maxLength={32}
              className="min-h-11 flex-1 rounded-xl bg-subtle px-3 text-xl"
            />
            <Button
              label="React"
              disabled={!isEmojiGrapheme(firstEmojiGrapheme(custom) ?? "")}
              onPress={() => void handleReaction(firstEmojiGrapheme(custom) ?? "")}
            />
          </View>
        ) : null}
        <ListSection>
          <ListActionRow
            label="Reply"
            icon="arrow.uturn.backward"
            disabled={!canOperate || !props.onReply}
            onPress={() => {
              props.onClose();
              props.onReply?.(text);
            }}
          />
          <ListActionRow
            label="Mark as unread"
            icon="bubble.left"
            disabled={!canOperate}
            onPress={() => {
              props.onClose();
              void markUnread({
                environmentId: props.environmentId,
                input: { threadId: props.threadId },
              });
            }}
          />
          <ListActionRow
            label="Copy"
            icon="doc.on.doc"
            onPress={() => {
              props.onClose();
              if (props.message.role === "user" && props.message.context) {
                void writeComposerContextClipboard(props.message.text, {
                  version: 1,
                  source: { environmentId: props.environmentId, messageId: props.message.id },
                  records: props.message.context.records,
                });
              } else copyTextWithHaptic(text);
            }}
          />
        </ListSection>
      </ScrollView>
    </Sheet>
  );
}

function reactionTimestamp() {
  return new Date().toISOString();
}
