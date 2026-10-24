import type { VoiceCallTarget } from "@t3tools/client-runtime/voice-call";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { IconButton } from "../../components/ui/IconButton";
import {
  resolveBotCallStart,
  type BotCallAvailability,
  type BotCallStartDecision,
  type BotCallSummary,
} from "./bot-call";

/**
 * What a Call tap does, shared by the button and the chat header's Call item. Calling someone
 * while another call is live asks first and then hands the runtime the id of the call the user
 * saw, which ends only that call before starting this one. If a different call is live by the
 * time they confirm, the runtime refuses.
 */
export function pressBotCall(input: {
  readonly decision: BotCallStartDecision;
  readonly botTitle: string;
  readonly onStart: (input: { readonly replacingCallId: string | null }) => void;
  readonly onOpenActive: () => void;
  /** Offered beside a reason the bot's voice settings can fix. */
  readonly onOpenSettings?: () => void;
}): void {
  const { decision, botTitle, onStart, onOpenSettings } = input;
  switch (decision.kind) {
    case "unavailable":
      // Phones have no hover, so the reason a call can't start is shown on tap.
      return decision.setup && onOpenSettings
        ? Dialog.alert(`Can’t call ${botTitle}`, decision.reason, [
            { text: "Not now", style: "cancel" },
            { text: "Voice settings", onPress: onOpenSettings },
          ])
        : Dialog.alert(`Can’t call ${botTitle}`, decision.reason);
    case "open-active":
      return input.onOpenActive();
    case "start":
      return onStart({ replacingCallId: decision.replacingCallId });
    case "confirm-switch":
      return Dialog.confirm({
        title: `Call ${botTitle}?`,
        message: decision.message,
        confirmText: "Switch call",
        onConfirm: () => onStart({ replacingCallId: decision.replacingCallId }),
      });
  }
}

/** Direct call access for a bot conversation. A null `threadId` is one not created yet. */
export function BotCallStartButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly bot: VoiceCallTarget["bot"];
  readonly active: BotCallSummary | null;
  readonly availability: BotCallAvailability;
  readonly onStart: (input: { readonly replacingCallId: string | null }) => void;
  readonly onOpenActive: () => void;
  readonly onOpenSettings?: () => void;
}) {
  const { bot } = props;
  const decision = resolveBotCallStart({
    active: props.active,
    target: { environmentId: props.environmentId, bot, threadId: props.threadId },
    availability: props.availability,
  });
  return (
    <IconButton
      accessibilityLabel={
        decision.kind === "open-active" ? `On a call with ${bot.title}` : `Call ${bot.title}`
      }
      icon="phone"
      selected={decision.kind === "open-active"}
      tintColorClassName={
        decision.kind === "open-active"
          ? "accent-primary"
          : decision.kind === "unavailable"
            ? "accent-icon-subtle"
            : undefined
      }
      onPress={() =>
        pressBotCall({
          decision,
          botTitle: bot.title,
          onStart: props.onStart,
          onOpenActive: props.onOpenActive,
          onOpenSettings: props.onOpenSettings,
        })
      }
    />
  );
}
