import { useAtomValue } from "@effect/atom-react";
import { botAvatarClipFor, botAvatarShowsLiveClips } from "@t3tools/client-runtime/bot-avatar";
import type {
  BotAvatar as BotAvatarState,
  EnvironmentId,
  ProjectIconOverride,
} from "@t3tools/contracts";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { SparklesIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { projectIconColorClassName } from "../../projectIconColors";
import { projectFaviconUrlAtom } from "../../state/assets";
import { ProjectFavicon } from "../ProjectFavicon";
import { useBotAvatarActivity } from "./botAvatarActivity";
import { botInitials } from "./botRoom.logic";

// Soft tints with the same hue in the letters, so a list of bots reads by colour without shouting.
const SPECIALIST_TINTS = [
  "bg-success/15 text-success-foreground",
  "bg-warning/15 text-warning-foreground",
  "bg-info/15 text-info-foreground",
  "bg-destructive/12 text-destructive-foreground",
  "bg-update/15 text-update-foreground",
] as const;

function specialistTint(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return SPECIALIST_TINTS[Math.abs(hash) % SPECIALIST_TINTS.length]!;
}

const SIZE_CLASS = {
  sm: "size-5 text-3xs",
  md: "size-6 text-2xs",
  lg: "size-8 text-xs",
  row: "size-24 text-2xl",
  hero: "size-24 text-2xl",
  list: "size-12 text-lg",
  profile: "size-32 text-3xl",
  xl: "size-20 text-2xl",
} as const;
const EMOJI_CLASS = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  row: "text-4xl",
  hero: "text-4xl",
  list: "text-2xl",
  profile: "text-5xl",
  xl: "text-4xl",
} as const;
const ICON_CLASS = {
  sm: "size-3",
  md: "size-3.5",
  lg: "size-4",
  row: "size-10",
  hero: "size-10",
  list: "size-6",
  profile: "size-14",
  xl: "size-9",
} as const;
// Specialists are rounded squares; the radius scales with the size so every one reads the same.
const SQUARE_RADIUS_CLASS = {
  sm: "rounded-md",
  md: "rounded-md",
  lg: "rounded-lg",
  row: "rounded-lg",
  hero: "rounded-xl",
  list: "rounded-xl",
  profile: "rounded-2xl",
  xl: "rounded-3xl",
} as const;
/** Decoding video for a 20 px face is waste, and a sidebar of rows must not all decode; only
 * the one hero, the empty-state face, and the profile ever play a clip. */
const LIVE_SIZES = new Set<BotAvatarSize>(["hero", "row", "list", "profile", "xl"]);

export type BotAvatarSize = keyof typeof SIZE_CLASS;

/** A bot's project record, or the call target's subset of it when no record is at hand. */
export interface BotAvatarBot {
  readonly id: string;
  readonly title: string;
  readonly botRole?: string | null | undefined;
  readonly environmentId?: EnvironmentId | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly projectIcon?: ProjectIconOverride | null | undefined;
  readonly faviconPath?: string | null | undefined;
  readonly botAvatar?: BotAvatarState | null | undefined;
}

export function botAvatarShapeClassName(botRole: string | null | undefined, size: BotAvatarSize) {
  return botRole === "assistant" ? "rounded-full" : SQUARE_RADIUS_CLASS[size];
}

/**
 * A bot's face: the emoji, letters, or photo chosen in its profile, else Assistant's sparkle or
 * initials. The choice is the project's own icon, so every surface shows the same one. Assistant
 * is round; every other bot is a rounded square, so the one Assistant stands apart in any list.
 * A generated avatar also plays its silent clip for what the bot is doing, at the larger sizes.
 */
export function BotAvatar({
  bot,
  size = "sm",
  className,
  live,
}: {
  bot: BotAvatarBot;
  size?: BotAvatarSize;
  className?: string | undefined;
  /** Defaults to the size's policy; pass false where a list of many bots would all decode video. */
  live?: boolean | undefined;
}) {
  const shape = cn(
    "inline-grid shrink-0 place-items-center overflow-hidden font-semibold tracking-tight select-none",
    botAvatarShapeClassName(bot.botRole, size),
    SIZE_CLASS[size],
    className,
  );
  const icon = bot.projectIcon ?? null;
  if (icon?.kind === "emoji") {
    return (
      <span
        aria-hidden
        className={cn(
          shape,
          icon.color === undefined ? specialistTint(bot.id) : projectIconColorClassName(icon.color),
        )}
        style={
          icon.color === undefined
            ? undefined
            : { backgroundColor: "color-mix(in srgb, currentColor 18%, transparent)" }
        }
      >
        <span className={cn("leading-none", EMOJI_CLASS[size])}>{icon.emoji}</span>
      </span>
    );
  }
  if (icon?.kind === "monogram") {
    return (
      <span
        aria-hidden
        className={cn(shape, projectIconColorClassName(icon.color))}
        style={{ backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)" }}
      >
        {icon.text}
      </span>
    );
  }
  if (icon?.kind === "lucide" && bot.environmentId && bot.workspaceRoot) {
    return (
      <span aria-hidden className={cn(shape, "bg-muted")}>
        <ProjectFavicon
          project={{
            environmentId: bot.environmentId,
            workspaceRoot: bot.workspaceRoot,
            title: bot.title,
            faviconPath: null,
            projectIcon: icon,
          }}
          className={ICON_CLASS[size]}
        />
      </span>
    );
  }
  const fallback =
    bot.botRole === "assistant" ? (
      <span
        aria-hidden
        className={cn(shape, "bg-linear-135 from-assistant to-assistant-deep text-white")}
      >
        <SparklesIcon className={ICON_CLASS[size]} />
      </span>
    ) : (
      <span aria-hidden className={cn(shape, specialistTint(bot.id))}>
        {botInitials(bot.title)}
      </span>
    );
  if (bot.faviconPath && bot.environmentId && bot.workspaceRoot) {
    const liveClips =
      (live ?? LIVE_SIZES.has(size)) && botAvatarShowsLiveClips(bot) && bot.botAvatar
        ? bot.botAvatar.clips
        : null;
    return (
      <BotPhoto
        botId={bot.id}
        environmentId={bot.environmentId}
        workspaceRoot={bot.workspaceRoot}
        faviconPath={bot.faviconPath}
        clips={liveClips}
        className={cn(shape, "rounded-full")}
        fallback={fallback}
      />
    );
  }
  return fallback;
}

/** Only bots with a saved photo resolve a URL, so plain avatars never touch the network. */
function BotPhoto(props: {
  botId: string;
  environmentId: EnvironmentId;
  workspaceRoot: string;
  faviconPath: string;
  clips: BotAvatarState["clips"] | null;
  className: string;
  fallback: ReactNode;
}) {
  const src = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: props.environmentId,
      cwd: props.workspaceRoot,
      faviconPath: props.faviconPath,
    }),
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || isProjectFaviconFallbackUrl(src) || failedSrc === src) return props.fallback;
  return (
    <span aria-hidden className={cn(props.className, "relative bg-muted")}>
      <img
        src={src}
        alt=""
        draggable={false}
        className="size-full object-cover"
        onError={() => setFailedSrc(src)}
      />
      {props.clips ? (
        <BotLiveClip
          botId={props.botId}
          environmentId={props.environmentId}
          workspaceRoot={props.workspaceRoot}
          clips={props.clips}
        />
      ) : null}
    </span>
  );
}

/**
 * The silent clip for the bot's current activity, layered over the still so the first frame is
 * never blank. It only decodes while on screen and the tab is visible, and never under reduced
 * motion; the still stays underneath for every other case, including a clip that fails to load.
 */
function BotLiveClip(props: {
  botId: string;
  environmentId: EnvironmentId;
  workspaceRoot: string;
  clips: BotAvatarState["clips"];
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const kind = useBotAvatarActivity({ id: props.botId, environmentId: props.environmentId });
  const clip = botAvatarClipFor(props.clips, kind);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Without an observer there is nothing to wait for; treat the clip as on screen.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [failed, setFailed] = useState<string | null>(null);
  const state = useAssetUrlState(
    reducedMotion || clip === null ? null : props.environmentId,
    reducedMotion || clip === null
      ? null
      : { _tag: "draft-workspace-file", cwd: props.workspaceRoot, path: clip },
  );
  const url = state._tag === "Success" ? state.url : null;

  // oxlint-disable-next-line t3code/react-effect-budget -- Visibility comes from the browser's observer, which has no render-time equivalent.
  useEffect(() => {
    if (video === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.1 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [video]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Playback is imperative on the media element and must follow tab visibility as well as state.
  useEffect(() => {
    if (video === null) return;
    const sync = () => {
      if (visible && document.visibilityState === "visible") {
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [video, visible]);

  if (url === null || failed === url) return null;
  return (
    <video
      ref={setVideo}
      key={url}
      src={url}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden
      className="absolute inset-0 size-full object-cover"
      onError={() => setFailed(url)}
    />
  );
}
