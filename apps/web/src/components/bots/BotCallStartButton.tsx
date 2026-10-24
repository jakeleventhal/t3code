import type { VoiceCallTarget } from "@t3tools/client-runtime/voice-call";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { PhoneIcon } from "lucide-react";

import { readLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveBotCallStart, type BotCallActive, type BotCallAvailability } from "./botCall.logic";

/**
 * Direct call access for a bot chat. Calling someone while another call is live asks first and
 * then hands the runtime the id of the call the user saw, which ends only that call before
 * starting this one. If a different call is live by the time they confirm, the runtime refuses.
 */
export function BotCallStartButton({
  environmentId,
  bot,
  threadId,
  active,
  availability,
  onStart,
  onOpenActive,
}: {
  environmentId: EnvironmentId;
  bot: VoiceCallTarget["bot"];
  /** Null when the conversation is created on call. */
  threadId: ThreadId | null;
  active: BotCallActive | null;
  availability: BotCallAvailability;
  onStart: (input: { readonly replacingCallId: string | null }) => void;
  onOpenActive: () => void;
}) {
  const decision = resolveBotCallStart({
    active,
    target: { environmentId, bot, threadId },
    availability,
  });
  const onCall = decision.kind === "open-active";
  const label =
    decision.kind === "unavailable"
      ? decision.reason
      : onCall
        ? `On a call with ${bot.title}`
        : decision.kind === "confirm-switch"
          ? `Call ${bot.title} (ends your call with ${decision.activeBotTitle})`
          : `Call ${bot.title}`;

  const press = async () => {
    switch (decision.kind) {
      case "unavailable":
        return;
      case "open-active":
        return onOpenActive();
      case "start":
        return onStart({ replacingCallId: decision.replacingCallId });
      case "confirm-switch": {
        const api = readLocalApi();
        if (api === undefined) return;
        if (await api.dialogs.confirm(decision.message)) {
          onStart({ replacingCallId: decision.replacingCallId });
        }
      }
    }
  };

  return (
    <Tooltip>
      {/* A span keeps the reason reachable on hover while the button itself is disabled. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={label}
          aria-pressed={onCall}
          data-pressed={onCall ? "" : undefined}
          disabled={decision.kind === "unavailable"}
          onClick={() => void press()}
        >
          <PhoneIcon />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
