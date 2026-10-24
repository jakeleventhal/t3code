import {
  ArrowUpIcon,
  ChevronUpIcon,
  MaximizeIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from "lucide-react";
import type { VoiceCallDraft, VoiceCallState } from "@t3tools/client-runtime/voice-call";
import { useRef, type ReactNode } from "react";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ProjectId } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useProject } from "../../state/entities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";
import {
  botCallCanToggleMute,
  botCallPhaseLabel,
  type BotCallControls,
  type BotCallTranscriptLine,
} from "./botCall.logic";

/**
 * The compact corner control for the one live call: who, a status word, and the controls. It
 * never shows what was said; the transcript exists only in the drawer the user opens, and the
 * `transcript` and `composer` slots mount only then, so a collapsed call never re-renders on
 * speech or typing. Pass a null `composer` when the call cannot take typed messages.
 */
export function BotCallDock({
  call,
  controls,
  expanded,
  onExpandedChange,
  transcript,
  composer,
}: {
  call: VoiceCallState;
  controls: BotCallControls;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  transcript: ReactNode;
  composer: ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  // The live record, so a name or picture changed mid-call shows here too.
  const project = useProject(scopeProjectRef(call.environmentId, ProjectId.make(call.bot.id)));
  const title = project?.title ?? call.bot.title;
  const failed = call.phase === "failed";
  const status =
    (failed || call.phase === "reconnecting") && call.error
      ? call.error
      : botCallPhaseLabel(call.phase, call.muted);
  const canMute = botCallCanToggleMute(call.phase);
  return (
    <div
      role="group"
      aria-label={`Call with ${title}`}
      className="surface-glass flex items-center gap-1 rounded-full border border-border/60 py-1 ps-1.5 pe-1 shadow-sm"
    >
      <BotAvatar bot={project ?? call.bot} className={cn(!failed && "ring-2 ring-success")} />
      <div className="flex min-w-0 max-w-40 flex-col px-1 leading-tight">
        <span className="truncate text-xs font-semibold">{title}</span>
        <span
          className={cn(
            "truncate text-2xs",
            failed ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>
      <CallIconButton
        label={call.muted ? "Unmute" : "Mute"}
        pressed={call.muted}
        disabled={!canMute}
        onClick={() => controls.toggleMute(call.callId)}
      >
        {call.muted ? <MicOffIcon /> : <MicIcon />}
      </CallIconButton>
      <Popover open={expanded} onOpenChange={onExpandedChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={expanded ? "Hide transcript" : "Show transcript"}
                  />
                }
              />
            }
          >
            <ChevronUpIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">{expanded ? "Hide transcript" : "Show transcript"}</TooltipPopup>
        </Tooltip>
        <PopoverPopup
          side="top"
          align="end"
          sideOffset={8}
          padding="none"
          width="md"
          aria-label="Call transcript"
          // Mouse and keyboard opens land in the type box. Touch takes the first button instead,
          // so opening the drawer to read does not raise the on-screen keyboard.
          initialFocus={(interactionType) =>
            interactionType === "touch" ||
            (drawerRef.current?.querySelector<HTMLElement>("[data-call-composer]") ?? true)
          }
        >
          <div ref={drawerRef} className="flex w-full flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="text-sm font-semibold">Transcript</span>
              <span className="truncate text-xs text-muted-foreground">{title}</span>
              <span className="flex-1" />
              <Button size="xs" variant="outline" onClick={() => controls.openChat(call)}>
                <MaximizeIcon />
                Open chat
              </Button>
            </div>
            {transcript}
            {composer}
            <div className="flex justify-end px-3 pb-2 text-2xs text-muted-foreground">
              <span>Esc to close</span>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
      <CallIconButton label="Open chat" onClick={() => controls.openChat(call)}>
        <MaximizeIcon />
      </CallIconButton>
      <CallIconButton
        label={failed ? "Dismiss" : "End call"}
        variant="ghost-destructive"
        onClick={() => controls.end(call.callId)}
      >
        <PhoneOffIcon />
      </CallIconButton>
    </div>
  );
}

function CallIconButton({
  label,
  pressed,
  disabled,
  variant = "ghost-muted",
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  variant?: "ghost-muted" | "ghost-destructive";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant={variant}
            aria-label={label}
            aria-pressed={pressed}
            data-pressed={pressed ? "" : undefined}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Types into the live voice session, not a separate thread turn, so typed and spoken input share
 * one exchange. The draft and its sending state belong to the call runtime, so closing the
 * drawer mid-send loses neither.
 */
export function BotCallComposer({
  draft,
  onDraftChange,
  onSendDraft,
}: {
  draft: VoiceCallDraft;
  onDraftChange: (text: string) => void;
  onSendDraft: () => void;
}) {
  const empty = draft.text.trim().length === 0;
  return (
    <form
      className="flex flex-col gap-1 px-2 pt-1 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.sending && !empty) onSendDraft();
      }}
    >
      <div className="flex items-center gap-1.5">
        {/* Stays editable while sending; the runtime keeps whatever was typed meanwhile. */}
        <Input
          data-call-composer=""
          size="sm"
          aria-label="Type to the call"
          placeholder="Type instead of talking…"
          value={draft.text}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <Button type="submit" size="icon-sm" aria-label="Send" disabled={draft.sending || empty}>
          <ArrowUpIcon />
        </Button>
      </div>
      {draft.error ? (
        <p className="px-1 text-xs text-destructive-foreground">{draft.error}</p>
      ) : null}
    </form>
  );
}

/**
 * The words of a call, oldest first. Reversed flex keeps the newest line in view without
 * scroll bookkeeping.
 */
/**
 * A live call pins to its newest words; a saved one reads from its first, so later pages
 * append below the reader instead of moving them.
 */
export function BotCallTranscript({
  entries,
  emptyLabel = "Nothing said yet.",
  anchor = "newest",
}: {
  entries: ReadonlyArray<BotCallTranscriptLine>;
  emptyLabel?: string;
  anchor?: "newest" | "start";
}) {
  if (entries.length === 0) {
    return <p className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div
      className={cn(
        "flex max-h-64 overflow-y-auto px-3 py-2.5 text-sm",
        anchor === "newest" ? "flex-col-reverse" : "flex-col",
      )}
    >
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <p
            key={entry.id}
            className={cn(
              "whitespace-pre-wrap break-words",
              entry.speaker === "user"
                ? "max-w-[90%] self-end rounded-xl bg-muted px-2.5 py-1.5"
                : "max-w-[95%] self-start",
              !entry.final && "text-muted-foreground",
            )}
          >
            {entry.text}
          </p>
        ))}
      </div>
    </div>
  );
}
