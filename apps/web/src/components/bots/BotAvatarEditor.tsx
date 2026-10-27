import { useAtomValue } from "@effect/atom-react";
import { botAvatarProviderAvailability } from "@t3tools/client-runtime/bot-avatar";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  BOT_AVATAR_MAX_BYTES,
  BOT_AVATAR_PROMPT_MAX_LENGTH,
  CommandId,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { ClapperboardIcon, ImageIcon, SmileIcon, UploadIcon } from "lucide-react";
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import { botEnvironment } from "../../state/bots";
import {
  useEnvironmentSupportsBotAvatarGeneration,
  useEnvironmentSupportsBotProfiles,
} from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { botAvatarShapeClassName } from "./BotAvatar";
import { beginBotAvatarConversation, describeBotAvatarImage } from "./botAvatarActions";
import {
  BOT_AVATAR_EMOJI_COLORS,
  BOT_AVATAR_EMOJI_GROUPS,
  firstGrapheme,
  isEmojiGrapheme,
} from "./botAvatarEmoji";

const AVATAR_PHOTO_SIZE = 256;
const AVATAR_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "Please try again.",
  });
}

type EditorMode = "choose" | "emoji" | "describe";

/**
 * Edit Avatar: three ways to give a bot a face. Live Animation starts a conversation with the
 * bot about what it should look like; Describe Image generates one still from a sentence;
 * Emoji picks a character and a background colour. A photo can still be uploaded or removed.
 */
export function BotAvatarEditor({
  project,
  onChange,
  onRemovePhoto,
  onDone,
}: {
  project: EnvironmentProject;
  onChange: (icon: ProjectIconOverride) => void;
  onRemovePhoto: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<EditorMode>("choose");
  if (mode === "emoji") {
    return (
      <EmojiEditor
        project={project}
        onCancel={() => setMode("choose")}
        onSave={(icon) => {
          onChange(icon);
          onDone();
        }}
      />
    );
  }
  if (mode === "describe") {
    return (
      <DescribeImageEditor
        project={project}
        onCancel={() => setMode("choose")}
        onStarted={onDone}
      />
    );
  }
  return (
    <AvatarChooser
      project={project}
      onRemovePhoto={onRemovePhoto}
      onDone={onDone}
      onPick={(choice) => {
        if (choice === "live") {
          if (beginBotAvatarConversation(project)) onDone();
          else
            reportFailure(
              "Open the bot's conversation first",
              new Error("The bot has no main conversation yet."),
            );
          return;
        }
        setMode(choice);
      }}
    />
  );
}

function useAvatarCapabilities(project: EnvironmentProject) {
  const supported = useEnvironmentSupportsBotAvatarGeneration(project.environmentId);
  const providers = useEnvironmentProviders().get(project.environmentId) ?? [];
  const estimate = botAvatarProviderAvailability(providers);
  const query = useEnvironmentQuery(
    supported
      ? botEnvironment.avatarCapabilities({ environmentId: project.environmentId, input: {} })
      : null,
  );
  if (!supported) {
    return {
      live: { available: false, reason: "Update T3 Code on this machine" },
      image: { available: false, reason: "Update T3 Code on this machine" },
    };
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
  // The server's answer is on its way; the provider list already on hand is a fair preview.
  return {
    live: {
      available: estimate.liveAnimation,
      reason: estimate.liveAnimationReason ?? "Requires Grok",
    },
    image: { available: estimate.image, reason: "No image provider" },
  };
}

function AvatarChooser({
  project,
  onPick,
  onRemovePhoto,
  onDone,
}: {
  project: EnvironmentProject;
  onPick: (choice: "live" | "describe" | "emoji") => void;
  onRemovePhoto: () => void;
  onDone: () => void;
}) {
  const capabilities = useAvatarCapabilities(project);
  const hasPhoto = (project.projectIcon ?? null) === null && project.faviconPath != null;
  const photosSupported = useEnvironmentSupportsBotProfiles(project.environmentId);
  const canUpload =
    useAtomValue(botEnvironment.setAvatar.permissionAtom(project.environmentId)) && photosSupported;
  const setAvatar = useAtomCommand(botEnvironment.setAvatar, { reportFailure: false });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = project.botAvatar?.job != null && project.botAvatar.job.status !== "failed";

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!AVATAR_PHOTO_TYPES.has(file.type)) {
      reportFailure("Could not use that photo", new Error("Use a PNG, JPEG, WebP or GIF."));
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await squareAvatarDataUrl(file);
      const result = await setAvatar({
        environmentId: project.environmentId,
        input: {
          commandId: CommandId.make(randomUUID()),
          projectId: project.id,
          image: { mimeType: "image/png", dataUrl },
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportFailure(`Could not save ${project.title}'s photo`, squashAtomCommandFailure(result));
      } else {
        onDone();
      }
    } catch (error) {
      reportFailure("Could not use that photo", error);
    }
    setUploading(false);
  };

  return (
    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2" role="group" aria-label="Edit avatar">
      <Choice
        icon={<ClapperboardIcon />}
        title="Live Animation"
        hint={
          busy
            ? "Already generating"
            : capabilities.live.available
              ? "Moves while working or on a call"
              : capabilities.live.reason
        }
        disabled={!capabilities.live.available || busy}
        onClick={() => onPick("live")}
      />
      <Choice
        icon={<ImageIcon />}
        title="Describe Image"
        hint={
          busy
            ? "Already generating"
            : capabilities.image.available
              ? "Generate one picture"
              : capabilities.image.reason
        }
        disabled={!capabilities.image.available || busy}
        onClick={() => onPick("describe")}
      />
      <Choice
        icon={<SmileIcon />}
        title="Emoji"
        hint="Choose emoji and colour"
        onClick={() => onPick("emoji")}
      />
      <div className="mt-1 flex items-center gap-1.5">
        {canUpload ? (
          <>
            <Button
              size="sm"
              variant="ghost-muted"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon />
              {uploading ? "Saving…" : "Photo"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => void upload(event)}
            />
          </>
        ) : null}
        {hasPhoto ? (
          <Button size="sm" variant="ghost-muted" onClick={onRemovePhoto}>
            Remove
          </Button>
        ) : null}
        <Button size="sm" className="ml-auto" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Choice({
  icon,
  title,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        disabled ? "opacity-60" : "hover:bg-accent",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function EmojiEditor({
  project,
  onCancel,
  onSave,
}: {
  project: EnvironmentProject;
  onCancel: () => void;
  onSave: (icon: ProjectIconOverride) => void;
}) {
  const current = project.projectIcon?.kind === "emoji" ? project.projectIcon : null;
  const [emoji, setEmoji] = useState<string>(current?.emoji ?? "🙂");
  const [color, setColor] = useState<ProjectIconColor>(current?.color ?? "sky");
  const [custom, setCustom] = useState("");

  const acceptCustom = (value: string) => {
    setCustom(value);
    const grapheme = firstGrapheme(value);
    if (grapheme !== null && isEmojiGrapheme(grapheme)) setEmoji(grapheme);
  };

  return (
    <div className="grid min-w-0 flex-1 gap-3" role="group" aria-label="Emoji avatar">
      <div className="flex justify-center">
        <span
          aria-hidden
          className={cn(
            "grid size-24 place-items-center text-6xl leading-none select-none",
            botAvatarShapeClassName(project.botRole, "xl"),
            projectIconColorClassName(color),
          )}
          style={{ backgroundColor: "color-mix(in srgb, currentColor 18%, transparent)" }}
        >
          {emoji}
        </span>
      </div>
      <div className="max-h-44 overflow-y-auto pr-1">
        {BOT_AVATAR_EMOJI_GROUPS.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="mb-1 px-0.5 text-2xs text-muted-foreground">{group.label}</p>
            <div className="grid grid-cols-8 gap-0.5" role="group" aria-label={group.label}>
              {group.emojis.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-label={entry}
                  aria-pressed={entry === emoji}
                  className={cn(
                    "grid size-7 place-items-center rounded-md text-lg leading-none outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    entry === emoji && "bg-accent ring-1 ring-inset ring-foreground/40",
                  )}
                  onClick={() => setEmoji(entry)}
                >
                  {entry}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Input
        size="sm"
        aria-label="Any emoji"
        placeholder="Or paste any emoji"
        value={custom}
        onChange={(event) => acceptCustom(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Background colour">
        {BOT_AVATAR_EMOJI_COLORS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-label={entry}
            aria-pressed={entry === color}
            className={cn(
              "size-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              projectIconColorClassName(entry),
              entry === color && "ring-2 ring-inset ring-foreground",
            )}
            style={{ backgroundColor: "color-mix(in srgb, currentColor 32%, transparent)" }}
            onClick={() => setColor(entry)}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave({ kind: "emoji", emoji, color })}>
          Done
        </Button>
      </div>
    </div>
  );
}

function DescribeImageEditor({
  project,
  onCancel,
  onStarted,
}: {
  project: EnvironmentProject;
  onCancel: () => void;
  onStarted: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const trimmed = prompt.trim();
  const submit = async () => {
    if (trimmed.length === 0 || sending) return;
    setSending(true);
    const started = await describeBotAvatarImage({
      environmentId: project.environmentId,
      projectId: project.id,
      prompt: trimmed,
    });
    setSending(false);
    if (started) onStarted();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <div className="grid min-w-0 flex-1 gap-2" role="group" aria-label="Describe image">
      <p className="text-xs text-muted-foreground">
        One sentence about the picture. It replaces the current avatar when it’s ready.
      </p>
      <Input
        autoFocus
        size="sm"
        aria-label="Image description"
        placeholder="A brass robot with round goggles"
        maxLength={BOT_AVATAR_PROMPT_MAX_LENGTH}
        value={prompt}
        onChange={(event) => setPrompt(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button size="sm" disabled={trimmed.length === 0 || sending} onClick={() => void submit()}>
          {sending ? <Spinner size="sm" /> : null}
          Generate
        </Button>
      </div>
    </div>
  );
}

/** Crops to a centered square and scales down, so a phone photo stays well under the limit. */
async function squareAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read.");
  });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(AVATAR_PHOTO_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That image couldn't be read.");
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length > Math.ceil((BOT_AVATAR_MAX_BYTES * 4) / 3)) {
      throw new Error("That photo is too large. Use one up to 2 MB.");
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
