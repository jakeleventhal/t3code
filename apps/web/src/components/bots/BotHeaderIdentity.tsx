import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { CircleUserRoundIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import { WorkspaceBreadcrumbText } from "../WorkspaceBreadcrumb";
import { BotAvatar } from "./BotAvatar";
import { useBotRoomStore } from "./botRoomStore";

/**
 * Who you're talking to, in every conversation with a bot: its main one and each topic. It opens
 * and closes that bot's profile beside the chat.
 */
export function BotHeaderIdentity({ project }: { project: EnvironmentProject }) {
  const profileOpen = useBotRoomStore((state) => state.profileOpen);
  return (
    <button
      type="button"
      aria-expanded={profileOpen}
      aria-label={profileOpen ? `Close ${project.title} profile` : `Open ${project.title} profile`}
      onClick={() => useBotRoomStore.getState().setProfileOpen(!profileOpen)}
      className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm font-medium text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <BotAvatar bot={project} />
      <WorkspaceBreadcrumbText className="max-w-40">{project.title}</WorkspaceBreadcrumbText>
    </button>
  );
}

export function BotProfileButton({ project }: { project: EnvironmentProject }) {
  const profileOpen = useBotRoomStore((state) => state.profileOpen);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            aria-label={`${project.title} profile`}
            aria-pressed={profileOpen}
            data-pressed={profileOpen || undefined}
            onClick={() => useBotRoomStore.getState().setProfileOpen(!profileOpen)}
          />
        }
      >
        <CircleUserRoundIcon />
        Profile
      </TooltipTrigger>
      <TooltipPopup side="bottom">Profile</TooltipPopup>
    </Tooltip>
  );
}
