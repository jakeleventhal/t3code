import { voiceCallStatusLabel } from "@t3tools/client-runtime/work-log/voice-call";
import type { EnvironmentId, ThreadId, VoiceCallSummary } from "@t3tools/contracts";
import { ChevronRightIcon, PhoneIcon } from "lucide-react";

import { useVoiceCallTranscript, type VoiceCallTranscriptView } from "../../state/botVoice";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { BotCallTranscript } from "./BotCallDock";

/**
 * A call in the conversation, collapsed by default. Its words, never audio, load only while
 * open, so collapsed calls cost nothing; the panel mounts only while open.
 */
export function BotCallCard({
  environmentId,
  threadId,
  call,
  open,
  onOpenChange,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  call: VoiceCallSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const transcript = useVoiceCallTranscript(
    open ? { environmentId, threadId, callId: call.callId, ended: call.endedAt !== null } : null,
  );
  return (
    <div className="w-full max-w-md rounded-lg border bg-card text-sm">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-start">
          <PhoneIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">Call with {call.botTitle}</span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            {voiceCallStatusLabel(call)}
          </span>
          <span className="flex-1" />
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="border-t">
            <BotCallCardTranscript transcript={transcript} ongoing={call.endedAt === null} />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

function BotCallCardTranscript({
  transcript,
  ongoing,
}: {
  transcript: VoiceCallTranscriptView;
  ongoing: boolean;
}) {
  const footer =
    transcript.status === "error" ? (
      <div className="flex items-center gap-2 px-3 py-3 text-xs">
        <span className="flex-1 text-destructive-foreground">{transcript.error}</span>
        <Button size="xs" variant="outline" onClick={transcript.retry}>
          Retry
        </Button>
      </div>
    ) : transcript.status === "loading" ? (
      <div className="flex justify-center px-3 py-4">
        <Spinner size="md" tone="muted" aria-label="Loading transcript" />
      </div>
    ) : transcript.hasMore ? (
      <div className="flex justify-center px-3 pb-2.5">
        <Button size="xs" variant="outline" onClick={transcript.loadMore}>
          Show more
        </Button>
      </div>
    ) : null;
  if (transcript.entries.length === 0 && transcript.status !== "ready") return footer;
  return (
    <>
      <BotCallTranscript
        entries={transcript.entries}
        anchor="start"
        emptyLabel={ongoing ? "Nothing said yet." : "Nothing was said."}
      />
      {footer}
    </>
  );
}
