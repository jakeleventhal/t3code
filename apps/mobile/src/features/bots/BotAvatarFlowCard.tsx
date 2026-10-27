import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { BotAvatarAssetPath, BotAvatarJob } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { useAssetUrl } from "../../state/assets";
import { dismissBotAvatarJob, retryBotAvatar, selectBotAvatarOption } from "./bot-avatar-actions";
import { botRole } from "./bot-room";
import { botAvatarRadius } from "./BotAvatar";

/**
 * The avatar change as it happens, above the bot chat's composer: progress while options
 * render, the four options to pick from, clips landing one by one, or a failure with Retry.
 * Nothing mounts while no change is in flight.
 */
export function BotAvatarFlowCard(props: {
  readonly project: EnvironmentProject;
  readonly className?: string;
}) {
  const avatar = props.project.botAvatar ?? null;
  const job = avatar?.job ?? null;
  if (avatar === null || job === null) return null;
  return (
    <View className={cn("rounded-2xl border border-border bg-card px-3 py-2.5", props.className)}>
      <FlowBody project={props.project} version={avatar.version} job={job} />
    </View>
  );
}

function FlowBody(props: {
  readonly project: EnvironmentProject;
  readonly version: string;
  readonly job: BotAvatarJob;
}) {
  const { project, job, version } = props;
  const [busy, setBusy] = useState(false);
  const ids = { environmentId: project.environmentId, projectId: project.id };
  const dismiss = async () => {
    setBusy(true);
    await dismissBotAvatarJob(ids);
    setBusy(false);
  };
  const retry = async () => {
    setBusy(true);
    await retryBotAvatar({ ...ids, version });
    setBusy(false);
  };
  const progress = (title: string, detail: string | null, action: string) => (
    <View className="flex-row items-center gap-2.5">
      <AppActivityIndicator />
      <View className="min-w-0 flex-1">
        <Text textRole="body" className="text-foreground">
          {title}
        </Text>
        {detail ? (
          <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Button tone="text" label={action} disabled={busy} onPress={() => void dismiss()} />
    </View>
  );
  switch (job.status) {
    case "generating-options":
      return progress(
        "Generating options",
        `“${job.prompt}” · four looks, about a minute`,
        "Cancel",
      );
    case "generating-image":
      return progress("Generating image", `“${job.prompt}”`, "Cancel");
    case "awaiting-selection":
      return (
        <View className="gap-2">
          <View className="flex-row items-start gap-2">
            <View className="min-w-0 flex-1">
              <Text textRole="body" className="text-foreground">
                Pick an avatar
              </Text>
              <Text textRole="footnote" className="text-foreground-muted">
                Choose a look, or describe changes below. Dismiss to return to chat.
              </Text>
            </View>
            <IconButton accessibilityLabel="Dismiss" icon="xmark" onPress={() => void dismiss()} />
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Avatar options"
            className="flex-row gap-2"
          >
            {(job.candidates ?? []).map((candidate, index) => (
              <Candidate
                key={candidate}
                project={project}
                candidate={candidate}
                index={index}
                disabled={busy}
                onPick={async () => {
                  setBusy(true);
                  await selectBotAvatarOption({ ...ids, version, candidate });
                  setBusy(false);
                }}
              />
            ))}
          </View>
        </View>
      );
    case "animating":
      return progress("Animating avatar", null, "Stop");
    case "failed":
      return (
        <View className="gap-2">
          <View className="flex-row items-start gap-2">
            <View className="min-w-0 flex-1">
              <Text textRole="body" className="text-foreground">
                {job.failedStep === "animation"
                  ? "Couldn’t animate the avatar"
                  : job.failedStep === "image"
                    ? "Couldn’t generate the image"
                    : "Couldn’t generate options"}
              </Text>
              <Text textRole="footnote" className="text-foreground-muted">
                {job.error ?? "Try again."}
                {job.failedStep === "animation" ? " The still stays as the avatar." : ""}
              </Text>
            </View>
            <IconButton accessibilityLabel="Dismiss" icon="xmark" onPress={() => void dismiss()} />
          </View>
          <View className="flex-row">
            <Button tone="secondary" label="Retry" disabled={busy} onPress={() => void retry()} />
          </View>
        </View>
      );
  }
}

function Candidate(props: {
  readonly project: EnvironmentProject;
  readonly candidate: BotAvatarAssetPath;
  readonly index: number;
  readonly disabled: boolean;
  readonly onPick: () => Promise<void>;
}) {
  const url = useAssetUrl(props.project.environmentId, {
    _tag: "draft-workspace-file",
    cwd: props.project.workspaceRoot,
    path: props.candidate,
  });
  const radius = botAvatarRadius(botRole(props.project) ?? "specialist", 72);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Option ${props.index + 1}`}
      disabled={props.disabled || !url}
      onPress={() => void props.onPick()}
      className="flex-1 items-center justify-center overflow-hidden bg-subtle active:opacity-70"
      style={{ aspectRatio: 1, borderRadius: radius }}
    >
      {url ? (
        <Image
          source={{ uri: url, cacheKey: `t3-bot-candidate:${props.candidate}` }}
          cachePolicy="memory-disk"
          contentFit="cover"
          accessibilityIgnoresInvertColors
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <AppActivityIndicator />
      )}
    </Pressable>
  );
}
