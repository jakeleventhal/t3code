import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { botAvatarClipFor, botAvatarShowsLiveClips } from "@t3tools/client-runtime/bot-avatar";
import type {
  BotAvatar as BotAvatarState,
  EnvironmentId,
  ProjectIconOverride,
} from "@t3tools/contracts";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { use, useEffect, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { projectIconColorClassNames, projectMonogramColor } from "../../lib/projectIcon";
import { projectFaviconUrlAtom, useAssetUrl } from "../../state/assets";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { useBotAvatarActivity } from "./bot-avatar-activity";
import type { BotRole } from "./bot-room";

/** The parts of a bot's project its face is drawn from. */
export interface BotAvatarProject {
  readonly id?: string;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly projectIcon?: ProjectIconOverride | null;
  readonly faviconPath?: string | null;
  readonly botAvatar?: BotAvatarState | null;
}

/** Tiny icons stay still; inbox rows additionally gate playback by their visible bounds. */
const LIVE_MIN_SIZE = 56;

export function botAvatarRadius(role: BotRole, size: number): number {
  return role === "assistant" ? size / 2 : Math.round(size * 0.3);
}

/**
 * A bot's face: the emoji, initials, or photo chosen in its profile, else Assistant's sparkle or
 * the bot's initial. The choice is the project's own icon, so every surface shows the same one.
 * Assistant is round; every other bot is a soft-tinted rounded square, so Assistant stands apart.
 * A generated avatar also plays its silent clip for what the bot is doing, at larger sizes.
 */
export function BotAvatar(props: {
  readonly role: BotRole;
  readonly title: string;
  readonly size: number;
  readonly project?: BotAvatarProject | null;
  /** Defaults to the size policy; pass false where a long list would decode many clips. */
  readonly live?: boolean;
}) {
  const { size, project } = props;
  const style = { width: size, height: size, borderRadius: botAvatarRadius(props.role, size) };
  const icon = project?.projectIcon ?? null;
  const tint = projectIconColorClassNames(projectMonogramColor(props.title));
  if (icon?.kind === "emoji") {
    const colors = icon.color === undefined ? tint : projectIconColorClassNames(icon.color);
    return (
      <View className={`items-center justify-center ${colors.background}`} style={style}>
        <Text allowFontScaling={false} style={{ fontSize: Math.round(size * 0.52) }}>
          {icon.emoji}
        </Text>
      </View>
    );
  }
  if (icon?.kind === "monogram" || icon?.kind === "lucide") {
    const colors = projectIconColorClassNames(icon.color);
    return (
      <View className={`items-center justify-center ${colors.background}`} style={style}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          className={`font-t3-bold ${colors.text}`}
          style={{ fontSize: Math.round(size * 0.4) }}
        >
          {icon.kind === "monogram" ? icon.text : initial(props.title)}
        </Text>
      </View>
    );
  }
  const fallback =
    props.role === "assistant" ? (
      <View className="items-center justify-center bg-primary" style={style}>
        <SymbolView
          name="sparkles"
          size={Math.round(size * 0.5)}
          tintColorClassName="accent-primary-foreground"
        />
      </View>
    ) : (
      <View className={`items-center justify-center ${tint.background}`} style={style}>
        <Text
          allowFontScaling={false}
          className={`font-t3-bold ${tint.text}`}
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {initial(props.title)}
        </Text>
      </View>
    );
  if (project?.faviconPath) {
    const live =
      (props.live ?? size >= LIVE_MIN_SIZE) &&
      project.id !== undefined &&
      botAvatarShowsLiveClips(project) &&
      project.botAvatar
        ? { botId: project.id, clips: project.botAvatar.clips }
        : null;
    return (
      <BotPhoto
        environmentId={project.environmentId}
        workspaceRoot={project.workspaceRoot}
        faviconPath={project.faviconPath}
        live={live}
        size={size}
        fallback={fallback}
        borderRadius={size / 2}
      />
    );
  }
  return fallback;
}

function initial(title: string) {
  return Array.from(title.trim())[0]?.toUpperCase() ?? "?";
}

/** Only bots with a saved photo resolve a URL, so plain avatars never touch the network. */
function BotPhoto(props: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly faviconPath: string;
  readonly live: { readonly botId: string; readonly clips: BotAvatarState["clips"] } | null;
  readonly size: number;
  readonly fallback: ReactNode;
  readonly borderRadius: number;
}) {
  const url = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: props.environmentId,
      cwd: props.workspaceRoot,
      faviconPath: props.faviconPath,
    }),
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || isProjectFaviconFallbackUrl(url) || failedUrl === url) return props.fallback;
  const inline = url.startsWith("data:");
  const frame = { width: props.size, height: props.size, borderRadius: props.borderRadius };
  return (
    <View style={[frame, { overflow: "hidden" }]}>
      <Image
        // Photos are content-addressed, so the path names the image for as long as it exists,
        // while the signed URL changes on every mint.
        source={
          inline
            ? { uri: url }
            : { uri: url, cacheKey: `t3-bot-photo:${props.environmentId}:${props.faviconPath}` }
        }
        cachePolicy={inline ? "memory" : "memory-disk"}
        contentFit="cover"
        accessibilityIgnoresInvertColors
        onError={() => setFailedUrl(url)}
        style={frame}
      />
      {props.live ? (
        <BotLiveClip
          botId={props.live.botId}
          environmentId={props.environmentId}
          workspaceRoot={props.workspaceRoot}
          clips={props.live.clips}
          size={props.size}
        />
      ) : null}
    </View>
  );
}

/**
 * The silent clip for the bot's current activity, over the still so the first frame is never
 * blank. It is muted, mixes with other audio so a live call is never ducked, pauses in the
 * background, and stays off under reduced motion; the still remains for every failure.
 */
function BotLiveClip(props: {
  readonly botId: string;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly clips: BotAvatarState["clips"];
  readonly size: number;
}) {
  const reducedMotion = useReducedMotion();
  const routeFocused = useIsFocused();
  const tabActive = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const focused = routeFocused && tabActive;
  const kind = useBotAvatarActivity({ id: props.botId, environmentId: props.environmentId });
  const clip = botAvatarClipFor(props.clips, kind);
  const url = useAssetUrl(
    reducedMotion || clip === null ? null : props.environmentId,
    reducedMotion || clip === null
      ? null
      : { _tag: "draft-workspace-file", cwd: props.workspaceRoot, path: clip },
  );
  const [failed, setFailed] = useState<string | null>(null);
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.audioMixingMode = "mixWithOthers";
    instance.showNowPlayingNotification = false;
    instance.staysActiveInBackground = false;
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- The native player is loaded and started imperatively; there is no declarative source prop that also pauses in the background.
  useEffect(() => {
    if (url === null || !focused) return;
    let cancelled = false;
    const play = () => {
      if (!cancelled && AppState.currentState === "active") player.play();
    };
    player
      .replaceAsync({ uri: url })
      .then(play)
      .catch(() => {
        if (!cancelled) setFailed(url);
      });
    const failure = player.addListener("statusChange", ({ status }) => {
      if (status === "error" && !cancelled) setFailed(url);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") play();
      else player.pause();
    });
    return () => {
      cancelled = true;
      failure.remove();
      appState.remove();
      try {
        player.pause();
      } catch {}
    };
  }, [player, url, focused]);

  if (url === null || failed === url) return null;
  return (
    <VideoView
      player={player}
      pointerEvents="none"
      nativeControls={false}
      contentFit="cover"
      allowsPictureInPicture={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, left: 0, width: props.size, height: props.size }}
    />
  );
}
