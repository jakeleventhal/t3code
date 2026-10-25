import { useAtomValue } from "@effect/atom-react";
import { LayoutGridIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentSupportsBotConversations, useProjects } from "../../state/entities";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { partitionEnvironmentBots } from "./botRoom.logic";
import { BOTS_UNSUPPORTED_MESSAGE, useBotActions } from "./useBotActions";
import { useDesignatedAssistantEnvironmentId } from "./useBotRoom";

/** The Bots room with no conversation selected. Opening Assistant is the only write here. */
export function BotsHome() {
  const environmentId = useDesignatedAssistantEnvironmentId();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const offline = environmentId !== null && !connectedEnvironmentIds.includes(environmentId);
  const projects = useProjects();
  const { assistant } = partitionEnvironmentBots(projects, environmentId);
  const name = assistant?.title ?? "Assistant";
  const supported = useEnvironmentSupportsBotConversations(environmentId);
  const canOpen = useAtomValue(botEnvironment.open.permissionAtom(environmentId)) && supported;
  const { openMainConversation } = useBotActions();
  const [opening, setOpening] = useState(false);

  const description =
    environmentId === null
      ? "Connect an environment to talk to Assistant and your bots."
      : assistant === null && !canOpen
        ? supported
          ? "Assistant isn’t set up yet, and this connection can’t start it."
          : BOTS_UNSUPPORTED_MESSAGE
        : offline
          ? `${name}’s environment is offline. ${name} stays there and answers again once it reconnects.`
          : `${name} is one ongoing conversation. Each bot you add keeps its own.`;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyMedia variant="icon">
            <LayoutGridIcon />
          </EmptyMedia>
          <EmptyTitle>Bots</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
          {environmentId !== null && (assistant !== null || canOpen) ? (
            <div className="mt-5 flex justify-center">
              <Button
                size="sm"
                disabled={opening}
                onClick={async () => {
                  setOpening(true);
                  await openMainConversation(environmentId, assistant);
                  setOpening(false);
                }}
              >
                {opening ? "Opening…" : `Open ${name}`}
              </Button>
            </div>
          ) : null}
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}
