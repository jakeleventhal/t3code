import { botAvatarClipKind } from "@t3tools/client-runtime/bot-avatar";
import type { BotAvatarClipKind, EnvironmentId } from "@t3tools/contracts";

import { useThreadShells } from "../../state/entities";
import { botThreadStatus } from "./bot-room";
import { useActiveBotCall } from "./use-bot-call";

/** Call activity takes precedence over work in any of the bot's conversations. */
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
