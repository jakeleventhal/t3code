import type { StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useShowConversationInBots } from "./use-assistant";
import { useBotAvailability, useCreateBot } from "./use-bot-conversation";

const MAX_NAME_LENGTH = 200;

/** Name a specialist. Its model starts at the environment default and is changed from its chat. */
export function NewBotSheet(props: StaticScreenProps<{ readonly environmentId: string }>) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const insets = useSafeAreaInsets();
  const showInBots = useShowConversationInBots();
  const { canStart: canCreate, reason } = useBotAvailability(environmentId);
  const { create, ready } = useCreateBot(environmentId);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const trimmed = name.trim();

  const submit = async () => {
    if (trimmed.length === 0 || creating) return;
    setCreating(true);
    const created = await create(trimmed);
    setCreating(false);
    if (created === null) return;
    showInBots({ environmentId: created.environmentId, threadId: created.threadId });
  };

  return (
    <View className="flex-1 bg-sheet">
      <KeyboardAvoidingView automaticOffset behavior="padding" className="flex-1">
        <View className="gap-4 px-5 pt-5" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <View className="gap-1">
            <Text textRole="title" className="font-t3-bold text-foreground">
              New bot
            </Text>
            <Text textRole="footnote" className="text-foreground-muted">
              A specialist has its own conversations, kept apart from your Assistant and your other
              bots by default.
            </Text>
          </View>
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Name, like Fitness or Finance"
            accessibilityLabel="Bot name"
            returnKeyType="done"
            onSubmitEditing={submit}
            editable={canCreate && ready}
          />
          {!canCreate || !ready ? (
            <Text textRole="footnote" className="text-foreground-muted">
              {reason ?? "No model is available on this environment. Set up a provider first."}
            </Text>
          ) : null}
          <Button
            tone="primary"
            label="Create"
            fullWidth
            loading={creating}
            disabled={!canCreate || !ready || trimmed.length === 0}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
