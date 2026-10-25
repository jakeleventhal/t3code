import { useAtomValue } from "@effect/atom-react";
import {
  scopeThreadRef,
  scopedProjectKey,
  scopeProjectRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  BOT_AVATAR_MAX_BYTES,
  CommandId,
  ProjectMonogramText,
  type BotFile,
  type BotFilesPage,
  type ProjectIconColor,
  type ProjectIconOverride,
  type ScheduledTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  LayoutTemplateIcon,
  MusicIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { cn, randomUUID } from "~/lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { projectIconColorClassName } from "../../projectIconColors";
import { deriveProjectIdentity } from "../../projectIdentity";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentSupportsBotProfiles, useThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { BotAvatar } from "./BotAvatar";
import { BotTurnSettingsPanel } from "./BotRuntimeSettings";
import {
  botFilePreviewTarget,
  botFileTitle,
  botFileVisual,
  botRoutineScheduleLabel,
  groupBotFiles,
  type BotFileVisual,
} from "./botProfile.logic";
import { botInitials } from "./botRoom.logic";
import { useBotRoomStore } from "./botRoomStore";
import { useBotActions } from "./useBotActions";

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
const AVATAR_PHOTO_SIZE = 256;
const AVATAR_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const isMonogramText = Schema.is(ProjectMonogramText);

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "Please try again.",
  });
}

/**
 * The bot profile beside its chat: a side panel on wide windows and a full-height sheet on
 * narrow ones. It mounts nothing while closed, so a bot chat pays for no routines or files.
 */
export function BotProfileHost({ project }: { project: EnvironmentProject }) {
  const open = useBotRoomStore((state) => state.profileOpen);
  const narrow = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const close = () => useBotRoomStore.getState().setProfileOpen(false);
  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && close()}>
        <SheetPopup side="right" showCloseButton={false}>
          <SheetTitle className="sr-only">{project.title}</SheetTitle>
          <BotProfilePanel key={scopedProjectKey(projectRef(project))} project={project} narrow />
        </SheetPopup>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      aria-label={`${project.title} profile`}
      className="flex w-82 min-w-0 flex-none flex-col border-l bg-background"
    >
      <BotProfilePanel
        key={scopedProjectKey(projectRef(project))}
        project={project}
        narrow={false}
      />
    </aside>
  );
}

function projectRef(project: EnvironmentProject) {
  return scopeProjectRef(project.environmentId, project.id);
}

function BotProfilePanel({ project, narrow }: { project: EnvironmentProject; narrow: boolean }) {
  const tab = useBotRoomStore((state) => state.profileTab);
  const environment = useEnvironment(project.environmentId);
  const connected = environment?.connection.phase === "connected";
  const environmentLabel = environment?.label ?? "this environment";
  return (
    // oxlint-disable-next-line t3code/require-centered-scroll-gutter -- The panel scrolls as one column; its rows run edge to edge.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-6">
      <div className="flex justify-end">
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label="Close profile"
          onClick={() => useBotRoomStore.getState().setProfileOpen(false)}
        >
          <XIcon />
        </Button>
      </div>
      <BotIdentity project={project} connected={connected} />
      <ToggleGroup
        aria-label="Profile sections"
        className="mx-auto mt-4"
        value={[tab]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "routines" || value === "files" || value === "settings") {
            useBotRoomStore.getState().setProfileTab(value);
          }
        }}
      >
        <Toggle value="routines">Routines</Toggle>
        <Toggle value="files">Files</Toggle>
        <Toggle value="settings">Settings</Toggle>
      </ToggleGroup>
      <div className="mt-4">
        {tab === "routines" ? (
          <BotRoutines
            project={project}
            connected={connected}
            environmentLabel={environmentLabel}
          />
        ) : tab === "files" ? (
          <BotFiles
            project={project}
            connected={connected}
            environmentLabel={environmentLabel}
            narrow={narrow}
          />
        ) : (
          <BotTurnSettingsPanel project={project} connected={connected} />
        )}
      </div>
    </div>
  );
}

function BotIdentity({ project, connected }: { project: EnvironmentProject; connected: boolean }) {
  const canOperate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const canEdit = canOperate && connected;
  const updateProject = useOrchestrationCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const [editingName, setEditingName] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const nameCommittedRef = useRef(false);

  const update = async (
    input: { title?: string; projectIcon?: ProjectIconOverride | null; faviconPath?: null },
    failureTitle: string,
  ) => {
    const result = await updateProject({
      environmentId: project.environmentId,
      input: { projectId: project.id, ...input },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(failureTitle, squashAtomCommandFailure(result));
    }
  };

  const commitName = (value: string) => {
    setEditingName(false);
    const title = value.trim();
    if (title.length === 0 || title === project.title) return;
    void update({ title }, `Could not rename ${project.title}`);
  };
  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      nameCommittedRef.current = true;
      commitName(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      nameCommittedRef.current = true;
      setEditingName(false);
    }
  };

  const avatar = <BotAvatar bot={project} size="xl" />;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {canEdit ? (
        <Popover open={avatarOpen} onOpenChange={setAvatarOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Change picture"
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring hover:opacity-90"
              />
            }
          >
            {avatar}
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="center" className="w-64">
            <BotAvatarEditor
              project={project}
              onChange={(projectIcon) =>
                void update({ projectIcon }, `Could not change ${project.title}'s picture`)
              }
              onRemovePhoto={() =>
                void update({ faviconPath: null }, `Could not remove ${project.title}'s photo`)
              }
              onDone={() => setAvatarOpen(false)}
            />
          </PopoverPopup>
        </Popover>
      ) : (
        avatar
      )}
      {editingName ? (
        <input
          autoFocus
          aria-label="Bot name"
          maxLength={200}
          defaultValue={project.title}
          className="w-full min-w-0 rounded-md bg-transparent px-2 text-center text-xl font-semibold outline-none ring-1 ring-ring"
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={onNameKeyDown}
          onBlur={(event) => {
            if (nameCommittedRef.current) return;
            commitName(event.currentTarget.value);
          }}
        />
      ) : canEdit ? (
        <button
          type="button"
          aria-label={`Rename ${project.title}`}
          className="max-w-full truncate rounded-md px-2 text-xl font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => {
            nameCommittedRef.current = false;
            setEditingName(true);
          }}
        >
          {project.title}
        </button>
      ) : (
        <h2 className="max-w-full truncate px-2 text-xl font-semibold">{project.title}</h2>
      )}
    </div>
  );
}

function initialsIcon(title: string, color: ProjectIconColor): ProjectIconOverride {
  const initials = botInitials(title).toUpperCase();
  return {
    kind: "monogram",
    text: isMonogramText(initials) ? initials : deriveProjectIdentity(title).monogram,
    color,
  };
}

function BotAvatarEditor({
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
  const icon = project.projectIcon ?? null;
  const hasPhoto = icon === null && project.faviconPath != null;
  const photosSupported = useEnvironmentSupportsBotProfiles(project.environmentId);
  const canUpload =
    useAtomValue(botEnvironment.setAvatar.permissionAtom(project.environmentId)) && photosSupported;
  const setAvatar = useAtomCommand(botEnvironment.setAvatar, { reportFailure: false });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      }
    } catch (error) {
      reportFailure("Could not use that photo", error);
    }
    setUploading(false);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-6 gap-1" role="group" aria-label="Emoji">
        {AVATAR_EMOJIS.map((emoji) => {
          const selected = icon?.kind === "emoji" && icon.emoji === emoji;
          return (
            <Button
              key={emoji}
              size="icon-sm"
              variant="ghost"
              aria-label={emoji}
              aria-pressed={selected}
              data-pressed={selected || undefined}
              onClick={() => onChange({ kind: "emoji", emoji })}
            >
              <span className="text-lg leading-none">{emoji}</span>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Initials color">
        {AVATAR_COLORS.map((color) => {
          const selected = icon?.kind === "monogram" && icon.color === color;
          return (
            <button
              key={color}
              type="button"
              aria-label={`Initials in ${color}`}
              aria-pressed={selected}
              className={cn(
                "grid size-7 place-items-center rounded-full text-2xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                projectIconColorClassName(color),
                selected && "ring-2 ring-inset ring-foreground",
              )}
              style={{ backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)" }}
              onClick={() => onChange(initialsIcon(project.title, color))}
            >
              {botInitials(project.title).toUpperCase()}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        {canUpload ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Saving…" : "Upload photo"}
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
          <Button size="sm" variant="ghost" onClick={onRemovePhoto}>
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

function PanelNote({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action}
    </div>
  );
}

function BotRoutines({
  project,
  connected,
  environmentLabel,
}: {
  project: EnvironmentProject;
  connected: boolean;
  environmentLabel: string;
}) {
  const environmentId = project.environmentId;
  const canToggle = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const setTaskEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "bot routine toggle",
    reportFailure: false,
  });
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (tasksQuery.data === null) {
    if (!connected) {
      return <PanelNote>{`Reconnect to ${environmentLabel} to see routines.`}</PanelNote>;
    }
    if (tasksQuery.error !== null) {
      return (
        <PanelNote
          action={
            <Button size="sm" variant="outline" onClick={tasksQuery.refresh}>
              Try again
            </Button>
          }
        >
          Couldn’t load routines.
        </PanelNote>
      );
    }
    return <PanelNote>Loading routines…</PanelNote>;
  }

  const routines = tasksQuery.data.tasks.filter((task) => task.projectId === project.id);
  if (routines.length === 0) {
    return (
      <PanelNote>
        {`No routines yet. Ask ${project.title} to do something on a schedule, and it shows up here.`}
      </PanelNote>
    );
  }

  const toggle = async (task: ScheduledTask, enabled: boolean) => {
    if (busyTaskId !== null) return;
    setBusyTaskId(task.id);
    const result = await setTaskEnabled({ environmentId, input: { id: task.id, enabled } });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(
        `Could not ${enabled ? "turn on" : "turn off"} ${task.title}`,
        squashAtomCommandFailure(result),
      );
    }
  };

  return (
    <section aria-label="Routines">
      <h3 className="mb-1.5 px-1 text-xs text-muted-foreground">Routines</h3>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {routines.map((task) => (
          <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", !task.enabled && "text-muted-foreground")}>
                {task.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {botRoutineScheduleLabel(task.schedule)}
              </p>
            </div>
            <Switch
              aria-label={task.title}
              checked={task.enabled}
              disabled={!canToggle || !connected || busyTaskId !== null}
              onCheckedChange={(enabled) => void toggle(task, enabled)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BotFiles({
  project,
  connected,
  environmentLabel,
  narrow,
}: {
  project: EnvironmentProject;
  connected: boolean;
  environmentLabel: string;
  narrow: boolean;
}) {
  const environmentId = project.environmentId;
  const supported = useEnvironmentSupportsBotProfiles(environmentId);
  const firstPage = useEnvironmentQuery(
    supported
      ? botEnvironment.files({
          environmentId,
          input: { projectId: project.id, limit: FILES_PAGE_SIZE },
        })
      : null,
  );
  const loadPage = useAtomQueryRunner(botEnvironment.files, { reportFailure: false });
  const [olderPages, setOlderPages] = useState<ReadonlyArray<BotFilesPage>>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const [previewFile, setPreviewFile] = useState<BotFile | null>(null);

  if (!supported) {
    return (
      <PanelNote>
        {connected
          ? `Update T3 Code on ${environmentLabel} to see files from chat here.`
          : `Reconnect to ${environmentLabel} to see files.`}
      </PanelNote>
    );
  }
  if (firstPage.data === null) {
    if (!connected)
      return <PanelNote>{`Reconnect to ${environmentLabel} to see files.`}</PanelNote>;
    if (firstPage.error !== null) {
      return (
        <PanelNote
          action={
            <Button size="sm" variant="outline" onClick={firstPage.refresh}>
              Try again
            </Button>
          }
        >
          Couldn’t load files.
        </PanelNote>
      );
    }
    return <PanelNote>Loading files…</PanelNote>;
  }

  const pages = [firstPage.data, ...olderPages];
  const seen = new Set<string>();
  const files = pages.flatMap((page) =>
    page.items.filter((file) => (seen.has(file.id) ? false : (seen.add(file.id), true))),
  );
  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const groups = groupBotFiles(files, nowMs);

  const showMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const result = await loadPage({
      environmentId,
      input: { projectId: project.id, cursor: nextCursor, limit: FILES_PAGE_SIZE },
    });
    setLoadingMore(false);
    if (result._tag === "Success") {
      setOlderPages((current) => [...current, result.value]);
    } else if (!isAtomCommandInterrupted(result)) {
      reportFailure("Couldn’t load more files", squashAtomCommandFailure(result));
    }
  };

  return (
    <section aria-label="Files from chat">
      {files.length === 0 && nextCursor === null ? (
        <PanelNote>{`Files you and ${project.title} share in chat show up here.`}</PanelNote>
      ) : null}
      {groups.map((group) => (
        <div key={group.label} className="mb-4">
          <h3 className="mb-1.5 px-1 text-xs text-muted-foreground">{group.label}</h3>
          <ul className="overflow-hidden rounded-xl border bg-card py-1">
            {group.files.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => setPreviewFile(file)}
                >
                  <BotFileThumbnail environmentId={environmentId} file={file} />
                  <span className="min-w-0 flex-1 truncate text-sm">{botFileTitle(file)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {nextCursor !== null ? (
        <Button
          size="sm"
          variant="ghost-muted"
          className="w-full"
          disabled={loadingMore || !connected}
          onClick={() => void showMore()}
        >
          {loadingMore ? "Loading…" : files.length === 0 ? "Show older files" : "Show more"}
        </Button>
      ) : null}
      {previewFile ? (
        <BotFilePreviewDialog
          project={project}
          file={previewFile}
          closeProfileOnShow={narrow}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}
    </section>
  );
}

const VISUAL_ICON: Record<BotFileVisual, typeof FileIcon> = {
  image: ImageIcon,
  document: FileTextIcon,
  table: FileSpreadsheetIcon,
  page: LayoutTemplateIcon,
  audio: MusicIcon,
  video: FilmIcon,
  file: FileIcon,
};

function BotFileThumbnail({
  environmentId,
  file,
}: {
  environmentId: EnvironmentProject["environmentId"];
  file: BotFile;
}) {
  const visual = botFileVisual(file);
  const target = botFilePreviewTarget(file);
  const imageUrl = useAssetUrlState(
    visual === "image" ? environmentId : null,
    visual === "image"
      ? {
          _tag: "attachment",
          attachmentId: target.attachmentId,
          fileName: target.name,
          mimeType: target.mimeType,
          disposition: "inline",
        }
      : null,
  );
  const [failed, setFailed] = useState(false);
  const Icon = VISUAL_ICON[visual];
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted text-muted-foreground"
    >
      {imageUrl._tag === "Success" && !failed ? (
        <img
          src={imageUrl.url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-4" />
      )}
    </span>
  );
}

function BotFilePreviewDialog({
  project,
  file,
  closeProfileOnShow,
  onClose,
}: {
  project: EnvironmentProject;
  file: BotFile;
  closeProfileOnShow: boolean;
  onClose: () => void;
}) {
  const sourceRef = scopeThreadRef(project.environmentId, file.sourceThreadId);
  const source = useThreadShell(sourceRef);
  const { openThread } = useBotActions();
  const target = botFilePreviewTarget(file);
  const conversation =
    file.sourceThreadId === project.botMainThreadId
      ? "Main conversation"
      : (source?.title ?? "Earlier conversation");
  const sharedAt = new Date(file.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const showInChat = () => {
    onClose();
    if (closeProfileOnShow) useBotRoomStore.getState().setProfileOpen(false);
    void openThread(sourceRef, { sourceEntryId: file.sourceMessageId ?? file.sourceTurnItemId });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        className="h-[min(85vh,52rem)] max-w-4xl overflow-hidden"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{botFileTitle(file)}</DialogTitle>
        <AttachmentFilePreview
          name={target.name}
          mimeType={target.mimeType}
          sizeBytes={target.sizeBytes}
          asset={{ environmentId: project.environmentId, attachmentId: target.attachmentId }}
          htmlRender={target.htmlRender}
          threadRef={sourceRef}
          origin={conversation}
          onClose={onClose}
        />
        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {`${sharedAt} · ${conversation}`}
          </p>
          <Button size="sm" variant="outline" disabled={source === null} onClick={showInChat}>
            Show in chat
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
