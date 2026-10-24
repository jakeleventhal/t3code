import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useBotRoomStore } from "./botRoomStore";

/** Shown on the bot thread opened from Code's Assistant panel, even with the sidebar hidden. */
export function BotReturnToCode({ threadRef }: { threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const returnKey = useBotRoomStore((state) => state.returnToCodeThreadKey);
  if (returnKey !== scopedThreadKey(threadRef)) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            onClick={() => void navigate({ href: useBotRoomStore.getState().codeHref ?? "/" })}
          />
        }
      >
        <ChevronLeftIcon />
        Code
      </TooltipTrigger>
      <TooltipPopup side="bottom">Back to Code, where you left it</TooltipPopup>
    </Tooltip>
  );
}
