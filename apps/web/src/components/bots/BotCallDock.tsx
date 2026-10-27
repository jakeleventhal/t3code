import {
  ArrowUpIcon,
  ChevronUpIcon,
  MaximizeIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from "lucide-react";
import type { VoiceCallDraft, VoiceCallState } from "@t3tools/client-runtime/voice-call";
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { secondTick } from "@t3tools/client-runtime/clock";
import { formatVoiceCallDuration } from "@t3tools/client-runtime/work-log/voice-call";
import { getDocumentActivity, subscribeDocumentActivity } from "../../lib/documentActivity";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ProjectId } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useProject } from "../../state/entities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";
import { CallWaveform } from "./CallWaveform";
import {
  botCallCanToggleMute,
  botCallPhaseLabel,
  type BotCallControls,
  type BotCallTranscriptLine,
} from "./botCall.logic";

/**
 * The one live call as a slim bar. The transcript and composer slots mount only while the drawer
 * is open, so speech and typing never re-render it; a null `composer` takes no typed messages.
 * `inline` is the call's own chat, where opening the chat would go nowhere.
 */
export function BotCallDock({
  call,
  controls,
  inline,
  expanded,
  onExpandedChange,
  transcript,
  composer,
}: {
  call: VoiceCallState;
  controls: BotCallControls;
  inline: boolean;
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
      className={cn(
        "flex flex-col rounded-xl border bg-card shadow-xs/5",
        inline ? "w-full" : "w-[min(360px,calc(100vw-2rem))]",
        failed && "border-destructive/40",
      )}
    >
      <div className="flex h-10 items-center gap-2 ps-2.5 pe-1">
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-success")}
        />
        <BotAvatar bot={project ?? call.bot} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-xs font-semibold">{title}</span>
          <span
            className={cn(
              "shrink-0 text-2xs",
              failed ? "text-destructive-foreground" : "text-muted-foreground",
            )}
          >
            {botCallPhaseLabel(call.phase, call.muted)}
          </span>
        </div>
        {!failed && call.connectedAt != null ? (
          <CallElapsed connectedAt={call.connectedAt} />
        ) : null}
        {failed ? null : (
          <CallWaveform
            live={canMute}
            className={cn(
              "shrink-0",
              call.phase === "speaking" ? "text-success" : "text-muted-foreground",
            )}
          />
        )}
        <div className="flex shrink-0 items-center">
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
              <TooltipPopup side="top">
                {expanded ? "Hide transcript" : "Show transcript"}
              </TooltipPopup>
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
                  {inline ? null : (
                    <Button size="xs" variant="outline" onClick={() => controls.openChat(call)}>
                      <MaximizeIcon />
                      Open chat
                    </Button>
                  )}
                </div>
                {call.error ? (
                  <p
                    role="status"
                    className="px-3 py-2 text-sm text-destructive-foreground wrap-anywhere"
                  >
                    {status}
                  </p>
                ) : null}
                {transcript}
                {composer}
                <div className="flex justify-end px-3 pb-2 text-2xs text-muted-foreground">
                  <span>Esc to close</span>
                </div>
              </div>
            </PopoverPopup>
          </Popover>
          {inline ? null : (
            <CallIconButton label="Open chat" onClick={() => controls.openChat(call)}>
              <MaximizeIcon />
            </CallIconButton>
          )}
          <CallIconButton
            label={failed ? "Dismiss" : "End call"}
            variant="ghost-destructive"
            onClick={() => controls.end(call.callId)}
          >
            <PhoneOffIcon />
          </CallIconButton>
        </div>
      </div>
      {call.error ? (
        <p role="status" className="px-3 pb-2 text-xs text-destructive-foreground wrap-anywhere">
          {status}
        </p>
      ) : null}
    </div>
  );
}

const noTick = () => () => {};
const documentVisible = () => getDocumentActivity().visible;

function CallElapsed({ connectedAt }: { connectedAt: number }) {
  const visible = useSyncExternalStore(subscribeDocumentActivity, documentVisible);
  const now = useSyncExternalStore(visible ? secondTick.subscribe : noTick, secondTick.getSnapshot);
  return (
    <span
      className="shrink-0 text-2xs tabular-nums text-muted-foreground"
      aria-label="Call duration"
    >
      {formatVoiceCallDuration(new Date(connectedAt).toISOString(), new Date(now).toISOString())}
    </span>
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
