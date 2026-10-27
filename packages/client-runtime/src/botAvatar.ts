import type {
  BotAvatar,
  BotAvatarAssetPath,
  BotAvatarClipKind,
  BotAvatarClips,
  ServerProvider,
} from "@t3tools/contracts";
import { isProviderAvailable } from "@t3tools/contracts";

/** Typed into a bot chat, this phrase starts the live-animation flow instead of a turn. */
export const BOT_AVATAR_PROMPT_PREFIX = "Change your avatar to ";

const AVATAR_PROMPT_PATTERN =
  /^\s*(?:please\s+)?change\s+(?:your|the|this bot'?s?)\s+avatar\s+(?:to|into)\s*:?\s*([\s\S]+?)\s*$/i;

/** The subject of an avatar request, or null when the text is an ordinary message. */
export function parseBotAvatarPrompt(text: string): string | null {
  const match = AVATAR_PROMPT_PATTERN.exec(text);
  const subject = match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return subject.length > 0 ? subject : null;
}

export interface BotAvatarActivity {
  readonly working: boolean;
  readonly onCall: boolean;
}

/** A call wins over work: the bot is still on the phone even while a task runs behind it. */
export function botAvatarClipKind(activity: BotAvatarActivity): BotAvatarClipKind {
  if (activity.onCall) return "call";
  if (activity.working) return "working";
  return "idle";
}

/**
 * The clip to show for an activity, falling back to the idle clip so a half-finished animation
 * still moves, and to nothing when no clip has arrived yet.
 */
export function botAvatarClipFor(
  clips: BotAvatarClips | undefined,
  kind: BotAvatarClipKind,
): BotAvatarAssetPath | null {
  if (!clips) return null;
  return clips[kind] ?? clips.idle ?? null;
}

/** Live clips belong to the still they were made from; any other picture turns them off. */
export function botAvatarShowsLiveClips(project: {
  readonly faviconPath?: string | null | undefined;
  readonly projectIcon?: unknown;
  readonly botAvatar?: BotAvatar | null | undefined;
}): boolean {
  return (
    project.botAvatar != null &&
    project.projectIcon == null &&
    typeof project.faviconPath === "string" &&
    Object.keys(project.botAvatar.clips).length > 0
  );
}

export type BotAvatarStatusLabel =
  | "Generating options"
  | "Choose an option"
  | "Animating avatar"
  | "Generating image"
  | "Couldn’t finish";

/** The short status shown beside the avatar while a change is in flight, or null when settled. */
export function botAvatarStatusLabel(
  avatar: BotAvatar | null | undefined,
): BotAvatarStatusLabel | null {
  const job = avatar?.job;
  if (!job) return null;
  switch (job.status) {
    case "generating-options":
      return "Generating options";
    case "awaiting-selection":
      return "Choose an option";
    case "animating":
      return "Animating avatar";
    case "generating-image":
      return "Generating image";
    case "failed":
      return "Couldn’t finish";
  }
}

export interface BotAvatarProviderAvailability {
  /** Live animation needs Grok's native video on a signed-in account. */
  readonly liveAnimation: boolean;
  readonly liveAnimationReason: string | null;
  /** Any signed-in provider with native image generation. */
  readonly image: boolean;
}

/**
 * The client's read of what the editor can offer before asking the server, from the provider
 * snapshots it already holds. The server's capabilities query remains the authority.
 */
export function botAvatarProviderAvailability(
  providers: ReadonlyArray<ServerProvider>,
): BotAvatarProviderAvailability {
  const grok = providers.filter((provider) => provider.driver === "grok");
  const usable = (provider: ServerProvider) =>
    provider.enabled &&
    provider.installed &&
    provider.auth.status === "authenticated" &&
    provider.status !== "error" &&
    provider.status !== "disabled" &&
    isProviderAvailable(provider);
  const liveProvider = grok.find(usable);
  const liveAnimationReason =
    liveProvider !== undefined
      ? null
      : grok.length === 0
        ? "Requires Grok"
        : grok.some((provider) => !provider.installed)
          ? "Grok isn’t installed"
          : grok.some((provider) => provider.auth.status !== "authenticated")
            ? "Grok isn’t signed in"
            : "Grok isn’t ready";
  return {
    liveAnimation: liveProvider !== undefined,
    liveAnimationReason,
    image:
      liveProvider !== undefined ||
      providers.some((provider) => provider.driver === "codex" && usable(provider)),
  };
}

const VARIATION_SELECTOR = 0xfe0f;
const ZERO_WIDTH_JOINER = 0x200d;
const KEYCAP = 0x20e3;
const isSkinTone = (point: number) => point >= 0x1f3fb && point <= 0x1f3ff;
const isTag = (point: number) => point >= 0xe0020 && point <= 0xe007f;
const isRegionalIndicator = (point: number) => point >= 0x1f1e6 && point <= 0x1f1ff;
const isCombining = (point: number) =>
  point === VARIATION_SELECTOR || point === KEYCAP || isSkinTone(point) || isTag(point);

/**
 * The first emoji grapheme of typed or pasted text, kept whole: a flag pair, a skin-toned hand,
 * a keycap, or a family joined by zero-width joiners is one picture and must not be cut. Written
 * by hand because the mobile runtime has no grapheme segmenter.
 */
export function firstEmojiGrapheme(text: string): string | null {
  const points = Array.from(text.trim(), (char) => char.codePointAt(0) ?? 0);
  if (points.length === 0) return null;
  const taken: Array<number> = [points[0]!];
  let index = 1;
  if (
    isRegionalIndicator(points[0]!) &&
    points[1] !== undefined &&
    isRegionalIndicator(points[1])
  ) {
    taken.push(points[1]);
    index = 2;
  }
  for (; index < points.length; index++) {
    const point = points[index]!;
    if (isCombining(point)) {
      taken.push(point);
    } else if (point === ZERO_WIDTH_JOINER && points[index + 1] !== undefined) {
      taken.push(point, points[index + 1]!);
      index += 1;
    } else break;
  }
  return String.fromCodePoint(...taken);
}

/** True when a grapheme renders as a picture, so a stray letter never becomes an avatar. */
export function isEmojiGrapheme(grapheme: string): boolean {
  const point = grapheme.codePointAt(0) ?? 0;
  return (
    point === 0xa9 ||
    point === 0xae ||
    (point >= 0x2190 && point <= 0x2bff) ||
    (point >= 0x3030 && point <= 0x3299) ||
    (point >= 0x1f000 && point <= 0x1faff) ||
    (point >= 0x30 && point <= 0x39 && grapheme.includes(String.fromCodePoint(KEYCAP)))
  );
}
