import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectIconOverride } from "@t3tools/contracts";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { SparklesIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import { projectFaviconUrlAtom } from "../../state/assets";
import { ProjectFavicon } from "../ProjectFavicon";
import { botInitials } from "./botRoom.logic";

const SPECIALIST_COLORS = [
  "bg-success",
  "bg-warning",
  "bg-info",
  "bg-destructive",
  "bg-update",
] as const;

function specialistColor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return SPECIALIST_COLORS[Math.abs(hash) % SPECIALIST_COLORS.length]!;
}

const SIZE_CLASS = {
  sm: "size-5 text-3xs",
  md: "size-6 text-2xs",
  xl: "size-20 text-2xl",
} as const;
const EMOJI_CLASS = { sm: "text-xs", md: "text-sm", xl: "text-4xl" } as const;
const ICON_CLASS = { sm: "size-3", md: "size-3.5", xl: "size-9" } as const;

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
}

/**
 * A bot's face: the emoji, letters, or photo chosen in its profile, else Assistant's sparkle or
 * initials. The choice is the project's own icon, so every surface shows the same one.
 */
export function BotAvatar({
  bot,
  size = "sm",
  className,
}: {
  bot: BotAvatarBot;
  size?: BotAvatarSize;
  className?: string;
}) {
  const shape = cn(
    "inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold tracking-tight select-none",
    SIZE_CLASS[size],
    className,
  );
  const icon = bot.projectIcon ?? null;
  if (icon?.kind === "emoji") {
    return (
      <span aria-hidden className={cn(shape, "bg-muted")}>
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
      <span aria-hidden className={cn(shape, "text-white", specialistColor(bot.id))}>
        {botInitials(bot.title)}
      </span>
    );
  if (bot.faviconPath && bot.environmentId && bot.workspaceRoot) {
    return (
      <BotPhoto
        environmentId={bot.environmentId}
        workspaceRoot={bot.workspaceRoot}
        faviconPath={bot.faviconPath}
        className={shape}
        fallback={fallback}
      />
    );
  }
  return fallback;
}

/** Only bots with a saved photo resolve a URL, so plain avatars never touch the network. */
function BotPhoto(props: {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  faviconPath: string;
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
    <span aria-hidden className={cn(props.className, "bg-muted")}>
      <img
        src={src}
        alt=""
        draggable={false}
        className="size-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
