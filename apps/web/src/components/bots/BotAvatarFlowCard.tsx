import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { BotAvatarAssetPath, BotAvatarJob } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useAssetUrlState } from "../../assets/assetUrls";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { botAvatarShapeClassName } from "./BotAvatar";
import { dismissBotAvatarJob, retryBotAvatar, selectBotAvatarOption } from "./botAvatarActions";

const CLIP_LABEL = { idle: "Idle", working: "Working", call: "On a call" } as const;

/**
 * The avatar change as it happens, pinned above the bot chat's composer: a progress line while
 * options render, the four options to pick from, the clips landing one by one, or a failure with
 * a retry. It mounts nothing when no change is in flight, so an ordinary chat pays nothing.
 */
export function BotAvatarFlowCard({ project }: { project: EnvironmentProject }) {
  const avatar = project.botAvatar ?? null;
  const job = avatar?.job ?? null;
  if (avatar === null || job === null) return null;
  return (
    <section
      aria-label="Avatar change"
      className="mx-auto mb-2 w-full max-w-3xl rounded-xl border bg-card px-3 py-2.5 text-sm shadow-xs/5"
    >
      <FlowBody project={project} version={avatar.version} job={job} clips={avatar.clips} />
    </section>
  );
}

function FlowBody({
  project,
  version,
  job,
  clips,
}: {
  project: EnvironmentProject;
  version: string;
  job: BotAvatarJob;
  clips: NonNullable<EnvironmentProject["botAvatar"]>["clips"];
}) {
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
  const header = (title: string, detail?: string) => (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Dismiss"
        disabled={busy}
        onClick={() => void dismiss()}
      >
        <XIcon />
      </Button>
    </div>
  );

  switch (job.status) {
    case "generating-options":
      return (
        <div className="flex items-center gap-2.5">
          <Spinner size="sm" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Generating options</p>
            <p className="truncate text-xs text-muted-foreground">
              “{job.prompt}” · four looks, about a minute
            </p>
          </div>
          <Button size="xs" variant="ghost-muted" disabled={busy} onClick={() => void dismiss()}>
            Cancel
          </Button>
        </div>
      );
    case "generating-image":
      return (
        <div className="flex items-center gap-2.5">
          <Spinner size="sm" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Generating image</p>
            <p className="truncate text-xs text-muted-foreground">“{job.prompt}”</p>
          </div>
          <Button size="xs" variant="ghost-muted" disabled={busy} onClick={() => void dismiss()}>
            Cancel
          </Button>
        </div>
      );
    case "awaiting-selection":
      return (
        <div className="grid gap-2">
          {header(
            "Pick an avatar",
            `“${job.prompt}” · the one you choose is used right away, then animated`,
          )}
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Avatar options">
            {(job.candidates ?? []).map((candidate, index) => (
              <CandidateButton
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
          </div>
        </div>
      );
    case "animating":
      return (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2.5">
            <Spinner size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Animating avatar</p>
              <p className="text-xs text-muted-foreground">
                The still is in place; each clip starts as soon as it lands.
              </p>
            </div>
            <Button size="xs" variant="ghost-muted" disabled={busy} onClick={() => void dismiss()}>
              Stop
            </Button>
          </div>
          <ClipProgress clips={clips} />
        </div>
      );
    case "failed":
      return (
        <div className="grid gap-2">
          {header(
            job.failedStep === "animation"
              ? "Couldn’t animate the avatar"
              : job.failedStep === "image"
                ? "Couldn’t generate the image"
                : "Couldn’t generate options",
            job.error ?? "Try again.",
          )}
          {job.failedStep === "animation" ? <ClipProgress clips={clips} /> : null}
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void retry()}>
              Retry
            </Button>
            {job.failedStep === "animation" ? (
              <span className="text-xs text-muted-foreground">The still stays as the avatar.</span>
            ) : null}
          </div>
        </div>
      );
  }
}

function ClipProgress({ clips }: { clips: NonNullable<EnvironmentProject["botAvatar"]>["clips"] }) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Clips">
      {(["idle", "working", "call"] as const).map((kind) => {
        const ready = clips[kind] !== undefined;
        return (
          <li
            key={kind}
            className={cn(
              "rounded-full border px-2 py-0.5",
              ready
                ? "border-success/40 bg-success/10 text-success-foreground"
                : "text-muted-foreground",
            )}
          >
            {CLIP_LABEL[kind]}
            {ready ? " ✓" : "…"}
          </li>
        );
      })}
    </ul>
  );
}

function CandidateButton({
  project,
  candidate,
  index,
  disabled,
  onPick,
}: {
  project: EnvironmentProject;
  candidate: BotAvatarAssetPath;
  index: number;
  disabled: boolean;
  onPick: () => Promise<void>;
}) {
  const asset = useAssetUrlState(project.environmentId, {
    _tag: "draft-workspace-file",
    cwd: project.workspaceRoot,
    path: candidate,
  });
  const url = asset._tag === "Success" ? asset.url : null;
  return (
    <button
      type="button"
      aria-label={`Option ${index + 1}`}
      disabled={disabled || !url}
      onClick={() => void onPick()}
      className={cn(
        "group relative aspect-square overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        botAvatarShapeClassName(project.botRole, "xl"),
        !disabled && "hover:ring-2 hover:ring-foreground/40",
      )}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <Spinner size="sm" />
      )}
      <span className="absolute bottom-1 left-1 rounded-full bg-background/80 px-1.5 text-2xs font-medium">
        {index + 1}
      </span>
    </button>
  );
}
