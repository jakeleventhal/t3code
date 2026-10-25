import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  type BotFile,
  type BotFilesPage,
  type ProjectIconColor,
  type ProjectIconOverride,
  type ScheduledTask,
} from "@t3tools/contracts";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/ui/AndroidScreenHeader";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { IconButton } from "../../components/ui/IconButton";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { assetImageSource } from "../../lib/assetImageSource";
import { cn } from "../../lib/cn";
import { projectIconColorClassNames } from "../../lib/projectIcon";
import { uuidv4 } from "../../lib/uuid";
import { useAssetUrl } from "../../state/assets";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentServerConfig, useProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { pickBotAvatarPhoto } from "./bot-avatar-photo";
import {
  botFilePreviewTarget,
  botFileTitle,
  botFileVisual,
  botInitials,
  botInitialsIcon,
  botRoutineScheduleLabel,
  groupBotFiles,
  mergeBotFilePages,
  type BotFileVisual,
} from "./bot-profile";
import { botRole } from "./bot-room";
import { BotAvatar } from "./BotAvatar";
import { useShowConversationInBots } from "./use-assistant";
import { useBotTurnSettings } from "./use-bot-turn-settings";

const FILES_PAGE_SIZE = 24;
const AVATAR_EMOJIS = ["🧭", "🌿", "📈", "☕", "🛰️", "🐙", "✈️", "🏠", "🦊", "🎧", "📚", "⚡"];
const AVATAR_COLORS: ReadonlyArray<ProjectIconColor> = [
  "amber",
  "sky",
  "green",
  "rose",
  "violet",
  "yellow",
  "gray",
];

type ProfileTab = "routines" | "files";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(title, error instanceof Error ? error.message : "Please try again.");
  }
}

/** Whether this environment can be reached right now, and what to call it when it can't. */
function useProfileEnvironment(environmentId: EnvironmentId) {
  const environment = useWorkspaceEnvironments().find(
    (entry) => entry.environmentId === environmentId,
  );
  const config = useEnvironmentServerConfig(environmentId);
  return {
    connected: environment?.connectionState === "connected",
    label: environment?.environmentLabel ?? "this environment",
    profilesSupported: config?.environment.capabilities.botProfiles === true,
    voiceConfigurable: config?.environment.capabilities.botVoiceConfiguration === true,
  };
}

/**
 * A bot's profile: who it is, what it does on a schedule, and what was shared in its chats.
 * Every chat with the bot opens the same profile, because all of it belongs to the bot's project.
 * Each tab subscribes only while it is showing, so a closed profile costs nothing.
 */
export function BotProfileSheet(
  props: StaticScreenProps<{ readonly environmentId: string; readonly projectId: string }>,
) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const projectId = ProjectId.make(props.route.params.projectId);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const project = useProject({ environmentId, projectId });
  const environment = useProfileEnvironment(environmentId);
  const [tab, setTab] = useState<ProfileTab>("routines");
  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View className="flex-1 bg-sheet">
      {Platform.OS === "android" ? <AndroidSheetHeader title="Profile" onBack={close} /> : null}
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerClassName="gap-4 px-4"
        contentContainerStyle={{
          paddingTop: Platform.OS === "ios" ? 12 : 16,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
        }}
      >
        {Platform.OS === "ios" ? (
          <View className="flex-row justify-end">
            <IconButton accessibilityLabel="Close profile" icon="xmark" onPress={close} />
          </View>
        ) : null}
        {project === null || botRole(project) === null ? (
          <ProfileNote>This bot isn’t on this device anymore.</ProfileNote>
        ) : (
          <>
            <BotIdentity project={project} connected={environment.connected} />
            {environment.voiceConfigurable ? (
              <View className="items-center">
                <Button
                  label="Voice settings"
                  icon="headphones"
                  onPress={() =>
                    navigation.navigate("SettingsSheet", {
                      screen: "SettingsContent",
                      params: {
                        screen: "SettingsVoiceBot",
                        params: { environmentId, projectId },
                      },
                    })
                  }
                />
              </View>
            ) : null}
            <BotTurnSettingsSection project={project} />
            <View className="items-center">
              <SegmentedControl
                role="tab"
                className="w-56"
                options={[
                  { value: "routines", label: "Routines" },
                  { value: "files", label: "Files" },
                ]}
                selected={tab}
                onSelect={setTab}
              />
            </View>
            {tab === "routines" ? (
              <BotRoutines
                project={project}
                connected={environment.connected}
                environmentLabel={environment.label}
              />
            ) : (
              <BotFiles
                project={project}
                connected={environment.connected}
                environmentLabel={environment.label}
                supported={environment.profilesSupported}
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The model and permissions this bot replies with. Picking happens in its settings page; returning
 * to the default is one tap here. Changes apply from the bot's next message.
 */
function BotTurnSettingsSection(props: { readonly project: EnvironmentProject }) {
  const { project } = props;
  const navigation = useNavigation();
  const turn = useBotTurnSettings(project.environmentId, project.id);
  if (!turn.supported) return null;
  const disabled = !turn.editable || !turn.canWrite || turn.pending;
  const open = () =>
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: {
        screen: "SettingsBotTurn",
        params: { environmentId: project.environmentId, projectId: project.id },
      },
    });
  return (
    <ListSection
      title="Model & permissions"
      footer={
        turn.updateMessage ??
        (turn.setupNeeded
          ? `Setup needed · ${turn.setupNeeded} ${
              turn.sources.model.own === null
                ? "Choose a model for this bot or fix the bot defaults."
                : "Choose another model or use the default."
            }`
          : "Changes apply from the next message.")
      }
    >
      <ListRow icon="sparkles" label="Model" description={turn.modelLabel} onPress={open} />
      {turn.sources.model.own !== null ? (
        <ListActionRow
          icon="arrow.uturn.backward"
          label="Use default model"
          description={turn.followedModelLabel}
          disabled={disabled}
          onPress={() => void turn.save({ modelSelection: null })}
        />
      ) : null}
      <ListRow
        icon="exclamationmark.shield"
        label="Permissions"
        description={turn.runtimeModeLabel}
        onPress={open}
      />
      {turn.sources.runtimeMode.own !== null ? (
        <ListActionRow
          icon="arrow.uturn.backward"
          label="Use default permissions"
          description={turn.followedRuntimeModeLabel}
          disabled={disabled}
          onPress={() => void turn.save({ runtimeMode: null })}
        />
      ) : null}
    </ListSection>
  );
}

function ProfileNote(props: { readonly children: string; readonly action?: ReactNode }) {
  return (
    <View className="items-center gap-3 px-6 py-8">
      <Text textRole="footnote" className="text-center text-foreground-muted">
        {props.children}
      </Text>
      {props.action}
    </View>
  );
}

function BotIdentity(props: { readonly project: EnvironmentProject; readonly connected: boolean }) {
  const { project } = props;
  const role = botRole(project) ?? "specialist";
  const canOperate = useAtomValue(botEnvironment.setAvatar.permissionAtom(project.environmentId));
  const canEdit = canOperate && props.connected;
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "bot profile update",
    reportFailure: false,
  });
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(project.title);
  const [avatarOpen, setAvatarOpen] = useState(false);
  // Shows a rename until the project catches up with it, without waiting on the round trip.
  const [pendingName, setPendingName] = useState<{ from: string; to: string } | null>(null);
  const title =
    pendingName !== null && project.title === pendingName.from ? pendingName.to : project.title;

  const update = async (
    input: { title?: string; projectIcon?: ProjectIconOverride | null; faviconPath?: null },
    failureTitle: string,
  ) => {
    const result = await updateProject({
      environmentId: project.environmentId,
      input: { projectId: project.id, ...input },
    });
    reportFailure(failureTitle, result);
    return result._tag === "Success";
  };

  const commitName = () => {
    if (!editingName) return;
    setEditingName(false);
    const next = draftName.trim();
    if (next.length === 0 || next === project.title) return;
    setPendingName({ from: project.title, to: next });
    void update({ title: next }, `Couldn’t rename ${project.title}`).then((saved) => {
      if (!saved) setPendingName(null);
    });
  };

  const avatar = <BotAvatar role={role} title={title} size={88} project={project} />;
  return (
    <View className="items-center gap-2">
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change picture"
          accessibilityState={{ expanded: avatarOpen }}
          onPress={() => {
            commitName();
            setAvatarOpen((open) => !open);
          }}
          className="rounded-full active:opacity-80"
        >
          {avatar}
        </Pressable>
      ) : (
        avatar
      )}
      {editingName ? (
        <TextInput
          autoFocus
          selectTextOnFocus
          accessibilityLabel="Bot name"
          value={draftName}
          onChangeText={setDraftName}
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={commitName}
          onBlur={commitName}
          className="min-w-40 max-w-full rounded-xl bg-card px-3 py-1 text-center text-xl font-t3-bold text-foreground"
        />
      ) : canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint="Rename this bot"
          onPress={() => {
            setAvatarOpen(false);
            setDraftName(title);
            setEditingName(true);
          }}
          className="max-w-full rounded-xl px-3 py-1 active:bg-subtle"
        >
          <Text
            textRole="title"
            className="text-center font-t3-bold text-foreground"
            numberOfLines={1}
          >
            {title}
          </Text>
        </Pressable>
      ) : (
        <Text
          textRole="title"
          accessibilityRole="header"
          className="px-3 py-1 text-center font-t3-bold text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
      )}
      {avatarOpen && canEdit ? (
        <BotAvatarEditor
          project={project}
          title={title}
          onChange={(projectIcon) =>
            void update({ projectIcon }, `Couldn’t change ${project.title}’s picture`)
          }
          onRemovePhoto={() =>
            void update({ faviconPath: null }, `Couldn’t remove ${project.title}’s photo`)
          }
          onDone={() => setAvatarOpen(false)}
        />
      ) : null}
    </View>
  );
}

function BotAvatarEditor(props: {
  readonly project: EnvironmentProject;
  readonly title: string;
  readonly onChange: (icon: ProjectIconOverride) => void;
  readonly onRemovePhoto: () => void;
  readonly onDone: () => void;
}) {
  const { project } = props;
  const icon = project.projectIcon ?? null;
  const hasPhoto = icon === null && project.faviconPath != null;
  const photosSupported =
    useEnvironmentServerConfig(project.environmentId)?.environment.capabilities.botProfiles ===
    true;
  const setAvatar = useAtomCommand(botEnvironment.setAvatar, {
    label: "bot profile photo",
    reportFailure: false,
  });
  const [uploading, setUploading] = useState(false);
  const initials = botInitials(props.title);

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
        reportFailure(`Couldn’t save ${project.title}’s photo`, result);
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
    <View className="mt-2 w-full gap-4 rounded-3xl border-continuous bg-grouped-card p-4">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Emoji"
        className="flex-row flex-wrap"
      >
        {AVATAR_EMOJIS.map((emoji) => {
          const selected = icon?.kind === "emoji" && icon.emoji === emoji;
          return (
            <Pressable
              key={emoji}
              accessibilityRole="radio"
              accessibilityLabel={emoji}
              accessibilityState={{ selected }}
              onPress={() => props.onChange({ kind: "emoji", emoji })}
              className={cn(
                "h-11 w-1/6 items-center justify-center rounded-xl active:bg-subtle",
                selected && "bg-subtle-strong",
              )}
            >
              <Text allowFontScaling={false} style={{ fontSize: 22 }}>
                {emoji}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {initials !== null ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Initials color"
          className="flex-row flex-wrap gap-2.5"
        >
          {AVATAR_COLORS.map((color) => {
            const selected = icon?.kind === "monogram" && icon.color === color;
            const colors = projectIconColorClassNames(color);
            const next = botInitialsIcon(props.title, color);
            return (
              <Pressable
                key={color}
                accessibilityRole="radio"
                accessibilityLabel={`Initials in ${color}`}
                accessibilityState={{ selected }}
                onPress={() => next && props.onChange(next)}
                className={cn(
                  "size-9 items-center justify-center rounded-full border-2 active:opacity-70",
                  colors.background,
                  selected ? "border-foreground" : "border-transparent",
                )}
              >
                <Text
                  allowFontScaling={false}
                  className={`font-t3-bold ${colors.text}`}
                  style={{ fontSize: 12 }}
                >
                  {initials}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View className="flex-row items-center gap-2">
        {photosSupported ? (
          <Button
            tone="secondary"
            label={uploading ? "Saving…" : "Choose photo"}
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

function BotRoutines(props: {
  readonly project: EnvironmentProject;
  readonly connected: boolean;
  readonly environmentLabel: string;
}) {
  const { project } = props;
  const environmentId = project.environmentId;
  const canToggle = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "bot routine toggle",
    reportFailure: false,
  });
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (tasks.data === null) {
    if (!props.connected) {
      return <ProfileNote>{`Reconnect to ${props.environmentLabel} to see routines.`}</ProfileNote>;
    }
    if (tasks.error !== null) {
      return (
        <ProfileNote action={<Button tone="secondary" label="Try again" onPress={tasks.refresh} />}>
          Couldn’t load routines.
        </ProfileNote>
      );
    }
    return <ProfileNote>Loading routines…</ProfileNote>;
  }

  const routines = tasks.data.tasks.filter((task) => task.projectId === project.id);
  if (routines.length === 0) {
    return (
      <ProfileNote>
        {`No routines yet. Ask ${project.title} to do something on a schedule, and it shows up here.`}
      </ProfileNote>
    );
  }

  const toggle = async (task: ScheduledTask, enabled: boolean) => {
    if (busyTaskId !== null) return;
    setBusyTaskId(task.id);
    const result = await setEnabled({ environmentId, input: { id: task.id, enabled } });
    setBusyTaskId(null);
    reportFailure(`Couldn’t turn ${enabled ? "on" : "off"} ${task.title}`, result);
  };

  return (
    <ListSection title="Routines">
      {routines.map((task, index) => (
        <View
          key={task.id}
          className={cn(
            "min-h-16 flex-row items-center gap-3 px-4 py-3",
            index > 0 && "border-t border-border-subtle",
          )}
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text
              textRole="body"
              className={task.enabled ? "text-foreground" : "text-foreground-muted"}
              numberOfLines={1}
            >
              {task.title}
            </Text>
            <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
              {botRoutineScheduleLabel(task.schedule)}
            </Text>
          </View>
          <ThemedSwitch
            accessibilityLabel={task.title}
            accessibilityHint={botRoutineScheduleLabel(task.schedule)}
            value={task.enabled}
            disabled={!canToggle || !props.connected || busyTaskId !== null}
            onValueChange={(enabled) => void toggle(task, enabled)}
          />
        </View>
      ))}
    </ListSection>
  );
}

function BotFiles(props: {
  readonly project: EnvironmentProject;
  readonly connected: boolean;
  readonly environmentLabel: string;
  readonly supported: boolean;
}) {
  const { project } = props;
  const environmentId = project.environmentId;
  // Each opening refetches the first page; older pages load only when asked for.
  const firstPage = useEnvironmentQuery(
    props.supported
      ? botEnvironment.files({
          environmentId,
          input: { projectId: project.id, limit: FILES_PAGE_SIZE },
        })
      : null,
  );
  const loadPage = useAtomQueryRunner(botEnvironment.files, {
    label: "bot files page",
    reportFailure: false,
  });
  const [olderPages, setOlderPages] = useState<ReadonlyArray<BotFilesPage>>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nowMs] = useState(() => Date.now());

  if (!props.supported) {
    return (
      <ProfileNote>
        {props.connected
          ? `Update T3 Code on ${props.environmentLabel} to see files from chat here.`
          : `Reconnect to ${props.environmentLabel} to see files.`}
      </ProfileNote>
    );
  }
  if (firstPage.data === null) {
    if (!props.connected) {
      return <ProfileNote>{`Reconnect to ${props.environmentLabel} to see files.`}</ProfileNote>;
    }
    if (firstPage.error !== null) {
      return (
        <ProfileNote
          action={<Button tone="secondary" label="Try again" onPress={firstPage.refresh} />}
        >
          Couldn’t load files.
        </ProfileNote>
      );
    }
    return <ProfileNote>Loading files…</ProfileNote>;
  }

  const { files, nextCursor } = mergeBotFilePages([firstPage.data, ...olderPages]);
  const groups = groupBotFiles(files, nowMs);

  const showMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const result = await loadPage({
      environmentId,
      input: { projectId: project.id, cursor: nextCursor, limit: FILES_PAGE_SIZE },
    });
    setLoadingMore(false);
    if (result._tag === "Success") setOlderPages((current) => [...current, result.value]);
    else reportFailure("Couldn’t load more files", result);
  };

  return (
    <View className="gap-5">
      {files.length === 0 && nextCursor === null ? (
        <ProfileNote>{`Files you and ${project.title} share in chat show up here.`}</ProfileNote>
      ) : null}
      {groups.map((group) => (
        <ListSection key={group.label} title={group.label}>
          {group.files.map((file, index) => (
            <BotFileRow key={file.id} project={project} file={file} first={index === 0} />
          ))}
        </ListSection>
      ))}
      {nextCursor !== null ? (
        <Button
          tone="text"
          fullWidth
          label={files.length === 0 ? "Show older files" : "Show more"}
          loading={loadingMore}
          disabled={loadingMore || !props.connected}
          onPress={() => void showMore()}
        />
      ) : null}
    </View>
  );
}

function BotFileRow(props: {
  readonly project: EnvironmentProject;
  readonly file: BotFile;
  readonly first: boolean;
}) {
  const { project, file } = props;
  const navigation = useNavigation();
  const showInBots = useShowConversationInBots();
  const title = botFileTitle(file);
  const target = botFilePreviewTarget(file);
  const preview = () =>
    navigation.navigate("ThreadAttachment", {
      environmentId: String(project.environmentId),
      threadId: String(file.sourceThreadId),
      attachmentId: target.attachmentId,
      name: target.name,
      mimeType: target.mimeType,
      sizeBytes: String(target.sizeBytes),
      ...(target.htmlRender ? { htmlRender: "1" as const } : {}),
    });
  const showInChat = () =>
    showInBots({
      environmentId: project.environmentId,
      threadId: file.sourceThreadId,
      reveal: { messageId: file.sourceMessageId, turnItemId: file.sourceTurnItemId },
    });
  // Images, PDFs, and videos open straight in the system viewer, which has no room for our
  // actions, so the way back to the chat lives on the row.
  return (
    <View
      className={cn(
        "min-h-13 flex-row items-center pr-1",
        !props.first && "border-t border-border-subtle",
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={preview}
        className="min-h-13 min-w-0 flex-1 flex-row items-center gap-3 py-2 pl-4 active:bg-subtle"
      >
        <BotFileThumbnail environmentId={project.environmentId} file={file} />
        <Text textRole="body" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
      <IconButton
        accessibilityLabel="Show in chat"
        icon="text.bubble"
        tintColorClassName="accent-icon-muted"
        onPress={showInChat}
      />
    </View>
  );
}

const VISUAL_ICON: Record<BotFileVisual, AppSymbolName> = {
  image: "photo",
  document: "doc.text",
  table: "chart.bar.xaxis",
  page: "globe",
  audio: "headphones",
  video: "play",
  file: "doc",
};

function BotFileThumbnail(props: {
  readonly environmentId: EnvironmentProject["environmentId"];
  readonly file: BotFile;
}) {
  const visual = botFileVisual(props.file);
  const target = botFilePreviewTarget(props.file);
  const resource =
    visual === "image"
      ? {
          _tag: "attachment" as const,
          attachmentId: target.attachmentId,
          fileName: target.name,
          mimeType: target.mimeType,
        }
      : null;
  const url = useAssetUrl(resource === null ? null : props.environmentId, resource);
  const [failed, setFailed] = useState(false);
  return (
    <View className="size-8 items-center justify-center overflow-hidden rounded-lg bg-subtle">
      {resource !== null && url !== null && !failed ? (
        <Image
          source={assetImageSource(props.environmentId, resource, url)}
          cachePolicy="memory-disk"
          contentFit="cover"
          recyclingKey={target.attachmentId}
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
          style={{ width: 32, height: 32 }}
        />
      ) : (
        <SymbolView name={VISUAL_ICON[visual]} size={16} tintColorClassName="accent-icon-muted" />
      )}
    </View>
  );
}
