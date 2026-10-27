import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { botAvatarClipKind, type BotAvatarActivity } from "@t3tools/client-runtime/bot-avatar";
import { ProjectId, type BotAvatarClipKind, type EnvironmentId } from "@t3tools/contracts";

import { useThreadShellsForProjectRefs } from "../../state/entities";
import { useVoiceCall } from "../../voice/useVoiceCall";

const RUNNING = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/**
 * What the bot is really doing right now, from its threads' runs and the one live call. Only the
 * animated avatar sizes subscribe to this, so small list rows never pay for it.
 */
export function useBotAvatarActivity(bot: {
  readonly id: string;
  readonly environmentId: EnvironmentId;
}): BotAvatarClipKind {
  const threads = useThreadShellsForProjectRefs([
    scopeProjectRef(bot.environmentId, ProjectId.make(bot.id)),
  ]);
  const call = useVoiceCall();
  const activity: BotAvatarActivity = {
    working: threads.some((thread) => RUNNING.has(thread.latestRun?.status ?? "")),
    onCall:
      call !== null &&
      call.phase !== "failed" &&
      call.environmentId === bot.environmentId &&
      call.bot.id === bot.id,
  };
  return botAvatarClipKind(activity);
}
