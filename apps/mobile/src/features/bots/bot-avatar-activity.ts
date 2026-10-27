import { botAvatarClipKind } from "@t3tools/client-runtime/bot-avatar";
import type { BotAvatarClipKind, EnvironmentId } from "@t3tools/contracts";

import { useThreadShells } from "../../state/entities";
import { botThreadStatus } from "./bot-room";
import { useActiveBotCall } from "./use-bot-call";

/**
 * What the bot is really doing, from its threads' runs and the one live call. Only animated
 * avatar sizes subscribe, so list rows never pay for it.
 */
export function useBotAvatarActivity(bot: {
  readonly id: string;
  readonly environmentId: EnvironmentId;
}): BotAvatarClipKind {
  const threads = useThreadShells();
  const call = useActiveBotCall();
  return botAvatarClipKind({
    working: threads.some(
      (thread) =>
        thread.environmentId === bot.environmentId &&
        thread.projectId === bot.id &&
        botThreadStatus(thread) === "working",
    ),
    onCall:
      call !== null &&
      call.phase !== "failed" &&
      call.environmentId === bot.environmentId &&
      call.bot.id === bot.id,
  });
}
