import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectIconOverride } from "@t3tools/contracts";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { projectIconColorClassNames } from "../../lib/projectIcon";
import { projectFaviconUrlAtom } from "../../state/assets";
import type { BotRole } from "./bot-room";

/** The parts of a bot's project its face is drawn from. */
export interface BotAvatarProject {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly projectIcon?: ProjectIconOverride | null;
  readonly faviconPath?: string | null;
}

/**
 * A bot's face: the emoji, initials, or photo chosen in its profile, else Assistant's sparkle or
 * the bot's initial. The choice is the project's own icon, so every surface shows the same one.
 */
export function BotAvatar(props: {
  readonly role: BotRole;
  readonly title: string;
  readonly size: number;
  readonly project?: BotAvatarProject | null;
}) {
  const { size, project } = props;
  const style = { width: size, height: size, borderRadius: size / 2 };
  const icon = project?.projectIcon ?? null;
  if (icon?.kind === "emoji") {
    return (
      <View className="items-center justify-center bg-subtle-strong" style={style}>
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
      <View className="items-center justify-center bg-subtle-strong" style={style}>
        <Text
          allowFontScaling={false}
          className="font-t3-bold text-foreground"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {initial(props.title)}
        </Text>
      </View>
    );
  if (project?.faviconPath) {
    return (
      <BotPhoto
        environmentId={project.environmentId}
        workspaceRoot={project.workspaceRoot}
        faviconPath={project.faviconPath}
        size={size}
        fallback={fallback}
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
  readonly size: number;
  readonly fallback: ReactNode;
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
  return (
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
      style={{ width: props.size, height: props.size, borderRadius: props.size / 2 }}
    />
  );
}
