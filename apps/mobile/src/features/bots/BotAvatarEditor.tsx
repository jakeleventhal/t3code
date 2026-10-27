import {
  botAvatarProviderAvailability,
  firstEmojiGrapheme,
  isEmojiGrapheme,
} from "@t3tools/client-runtime/bot-avatar";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  BOT_AVATAR_PROMPT_MAX_LENGTH,
  CommandId,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { cn } from "../../lib/cn";
import { projectIconColorClassNames } from "../../lib/projectIcon";
import { uuidv4 } from "../../lib/uuid";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { pickBotAvatarPhoto } from "./bot-avatar-photo";
import { BOT_AVATAR_EMOJI_COLORS, BOT_AVATAR_EMOJI_GROUPS } from "./bot-avatar-emoji";
import { beginBotAvatarConversation, describeBotAvatarImage } from "./bot-avatar-actions";
import { botRole } from "./bot-room";
import { botAvatarRadius } from "./BotAvatar";

type EditorMode = "choose" | "emoji" | "describe";

/**
 * Edit Avatar: Live Animation starts a conversation with the bot about what it should look
 * like; Describe Image generates one still from a sentence; Emoji picks a character on a colour.
 * A photo can still be chosen or removed.
 */
export function BotAvatarEditor(props: {
  readonly project: EnvironmentProject;
  readonly onChange: (icon: ProjectIconOverride) => void;
  readonly onRemovePhoto: () => void;
  readonly onDone: () => void;
  readonly onOpenConversation: (target: {
    readonly environmentId: EnvironmentProject["environmentId"];
    readonly threadId: NonNullable<EnvironmentProject["botMainThreadId"]>;
  }) => void;
}) {
  const [mode, setMode] = useState<EditorMode>("choose");
  if (mode === "emoji") {
    return (
      <EmojiEditor
        project={props.project}
        onCancel={() => setMode("choose")}
        onSave={(icon) => {
          props.onChange(icon);
          props.onDone();
        }}
      />
    );
  }
  if (mode === "describe") {
    return (
      <DescribeImageEditor
        project={props.project}
        onCancel={() => setMode("choose")}
        onStarted={props.onDone}
      />
    );
  }
  return (
    <AvatarChooser
      project={props.project}
      onRemovePhoto={props.onRemovePhoto}
      onDone={props.onDone}
      onPick={(choice) => {
        if (choice === "live") {
          const target = beginBotAvatarConversation(props.project);
          if (target === null) {
            Dialog.alert("Open the conversation first", "This bot has no main conversation yet.");
            return;
          }
          props.onDone();
          props.onOpenConversation(target);
          return;
        }
        setMode(choice);
      }}
    />
  );
}

function useAvatarCapabilities(project: EnvironmentProject) {
  const config = useEnvironmentServerConfig(project.environmentId);
  const supported = config?.environment.capabilities.botAvatarGeneration === true;
  const estimate = botAvatarProviderAvailability(config?.providers ?? []);
  const query = useEnvironmentQuery(
    supported
      ? botEnvironment.avatarCapabilities({ environmentId: project.environmentId, input: {} })
      : null,
  );
  if (!supported) {
    const reason = "Update T3 Code on this machine";
    return { live: { available: false, reason }, image: { available: false, reason } };
  }
  if (query.data !== null) {
    return {
      live: {
        available: query.data.liveAnimation.available,
        reason: query.data.liveAnimation.reason ?? "Requires Grok",
      },
      image: {
        available: query.data.image.available,
        reason: query.data.image.reason ?? "No image provider",
      },
    };
  }
  return {
    live: {
      available: estimate.liveAnimation,
      reason: estimate.liveAnimationReason ?? "Requires Grok",
    },
    image: { available: estimate.image, reason: "No image provider" },
  };
}

function AvatarChooser(props: {
  readonly project: EnvironmentProject;
  readonly onPick: (choice: "live" | "describe" | "emoji") => void;
  readonly onRemovePhoto: () => void;
  readonly onDone: () => void;
}) {
  const { project } = props;
  const capabilities = useAvatarCapabilities(project);
  const hasPhoto = (project.projectIcon ?? null) === null && project.faviconPath != null;
  const photosSupported =
    useEnvironmentServerConfig(project.environmentId)?.environment.capabilities.botProfiles ===
    true;
  const setAvatar = useAtomCommand(botEnvironment.setAvatar, {
    label: "bot profile photo",
    reportFailure: false,
  });
  const [uploading, setUploading] = useState(false);
  const busy = project.botAvatar?.job != null && project.botAvatar.job.status !== "failed";

  const choosePhoto = async () => {
    if (uploading) return;
    setUploading(true);
    // No `finally`: the React Compiler cannot lower it. Every path below reaches the reset.
    try {
      const image = await pickBotAvatarPhoto();
      if (image !== null) {
        const result = await setAvatar({
          environmentId: project.environmentId,
          input: { commandId: CommandId.make(uuidv4()), projectId: project.id, image },
        });
        if (result._tag === "Success") props.onDone();
        else Dialog.alert(`Couldn’t save ${project.title}’s photo`, "Please try again.");
      }
    } catch (error) {
      Dialog.alert(
        "Couldn’t use that photo",
        error instanceof Error ? error.message : "Please try another one.",
      );
    }
    setUploading(false);
  };

  return (
    <View className="mt-2 w-full gap-3 rounded-3xl border-continuous bg-grouped-card p-4">
      <ChoiceRow
        icon="play"
        title="Live Animation"
        hint={
          busy
            ? "Already generating"
            : capabilities.live.available
              ? "Describe it in chat; it moves while the bot works or talks"
              : capabilities.live.reason
        }
        disabled={!capabilities.live.available || busy}
        onPress={() => props.onPick("live")}
      />
      <ChoiceRow
        icon="photo"
        title="Describe Image"
        hint={
          busy
            ? "Already generating"
            : capabilities.image.available
              ? "One sentence, one generated picture"
              : capabilities.image.reason
        }
        disabled={!capabilities.image.available || busy}
        onPress={() => props.onPick("describe")}
      />
      <ChoiceRow
        icon="face.smiling"
        title="Emoji"
        hint="Any emoji on a colour you choose"
        onPress={() => props.onPick("emoji")}
      />
      <View className="flex-row items-center gap-2">
        {photosSupported ? (
          <Button
            tone="secondary"
            label={uploading ? "Saving…" : "Photo"}
            loading={uploading}
            disabled={uploading}
            onPress={() => void choosePhoto()}
          />
        ) : null}
        {hasPhoto ? <Button tone="text" label="Remove" onPress={props.onRemovePhoto} /> : null}
        <View className="flex-1" />
        <Button tone="primary" label="Done" onPress={props.onDone} />
      </View>
    </View>
  );
}

function ChoiceRow(props: {
  readonly icon: AppSymbolName;
  readonly title: string;
  readonly hint: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-14 flex-row items-center gap-3 rounded-2xl bg-card px-3 py-2 active:bg-subtle",
        props.disabled && "opacity-60",
      )}
    >
      <View className="size-9 items-center justify-center rounded-full bg-subtle">
        <SymbolView name={props.icon} size={18} tintColorClassName="accent-icon-muted" />
      </View>
      <View className="min-w-0 flex-1">
        <Text textRole="body" className="text-foreground">
          {props.title}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
          {props.hint}
        </Text>
      </View>
    </Pressable>
  );
}

function EmojiEditor(props: {
  readonly project: EnvironmentProject;
  readonly onCancel: () => void;
  readonly onSave: (icon: ProjectIconOverride) => void;
}) {
  const current = props.project.projectIcon?.kind === "emoji" ? props.project.projectIcon : null;
  const [emoji, setEmoji] = useState<string>(current?.emoji ?? "🙂");
  const [color, setColor] = useState<ProjectIconColor>(current?.color ?? "sky");
  const [custom, setCustom] = useState("");
  const colors = projectIconColorClassNames(color);
  const role = botRole(props.project) ?? "specialist";

  const acceptCustom = (value: string) => {
    setCustom(value);
    const grapheme = firstEmojiGrapheme(value);
    if (grapheme !== null && isEmojiGrapheme(grapheme)) setEmoji(grapheme);
  };

  return (
    <View className="mt-2 w-full gap-4 rounded-3xl border-continuous bg-grouped-card p-4">
      <View className="items-center">
        <View
          className={`items-center justify-center ${colors.background}`}
          style={{ width: 112, height: 112, borderRadius: botAvatarRadius(role, 112) }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 60 }}>
            {emoji}
          </Text>
        </View>
      </View>
      <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
        {BOT_AVATAR_EMOJI_GROUPS.map((group) => (
          <View key={group.label} className="mb-2">
            <Text textRole="footnote" className="mb-1 text-foreground-muted">
              {group.label}
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={group.label}
              className="flex-row flex-wrap"
            >
              {group.emojis.map((entry) => (
                <Pressable
                  key={entry}
                  accessibilityRole="radio"
                  accessibilityLabel={entry}
                  accessibilityState={{ selected: entry === emoji }}
                  onPress={() => setEmoji(entry)}
                  className={cn(
                    "h-11 w-1/8 items-center justify-center rounded-xl active:bg-subtle",
                    entry === emoji && "bg-subtle-strong",
                  )}
                >
                  <Text allowFontScaling={false} style={{ fontSize: 24 }}>
                    {entry}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <TextInput
        accessibilityLabel="Any emoji"
        placeholder="Or type any emoji"
        value={custom}
        onChangeText={acceptCustom}
        autoCorrect={false}
        className="rounded-xl bg-card px-3 py-2 text-foreground"
      />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Background colour"
        className="flex-row flex-wrap gap-2.5"
      >
        {BOT_AVATAR_EMOJI_COLORS.map((entry) => {
          const swatch = projectIconColorClassNames(entry);
          return (
            <Pressable
              key={entry}
              accessibilityRole="radio"
              accessibilityLabel={entry}
              accessibilityState={{ selected: entry === color }}
              onPress={() => setColor(entry)}
              className={cn(
                "size-8 items-center justify-center rounded-full border-2",
                swatch.background,
                entry === color ? "border-foreground" : "border-transparent",
              )}
            >
              <View className={cn("size-3.5 rounded-full", swatch.background)} />
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row items-center justify-end gap-2">
        <Button tone="text" label="Cancel" onPress={props.onCancel} />
        <Button
          tone="primary"
          label="Done"
          onPress={() => props.onSave({ kind: "emoji", emoji, color })}
        />
      </View>
    </View>
  );
}

function DescribeImageEditor(props: {
  readonly project: EnvironmentProject;
  readonly onCancel: () => void;
  readonly onStarted: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const trimmed = prompt.trim();
  const submit = async () => {
    if (trimmed.length === 0 || sending) return;
    setSending(true);
    const started = await describeBotAvatarImage({
      environmentId: props.project.environmentId,
      projectId: props.project.id,
      prompt: trimmed,
    });
    setSending(false);
    if (started) props.onStarted();
  };
  return (
    <View className="mt-2 w-full gap-3 rounded-3xl border-continuous bg-grouped-card p-4">
      <Text textRole="footnote" className="text-foreground-muted">
        One sentence about the picture. It replaces the current avatar when it’s ready.
      </Text>
      <TextInput
        autoFocus
        accessibilityLabel="Image description"
        placeholder="A brass robot with round goggles"
        value={prompt}
        onChangeText={setPrompt}
        maxLength={BOT_AVATAR_PROMPT_MAX_LENGTH}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        className="rounded-xl bg-card px-3 py-2 text-foreground"
      />
      <View className="flex-row items-center justify-end gap-2">
        <Button tone="text" label="Cancel" disabled={sending} onPress={props.onCancel} />
        <Button
          tone="primary"
          label="Generate"
          loading={sending}
          disabled={trimmed.length === 0 || sending}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}
