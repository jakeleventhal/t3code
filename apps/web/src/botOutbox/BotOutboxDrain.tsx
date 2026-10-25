import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { useConnectedEnvironmentIds } from "../state/environments";
import { useRememberSessionGrants } from "../state/session";
import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { botOutbox } from "./botOutbox";

/**
 * Delivers unsent bot messages whenever their host is connected and its thread list is current,
 * whichever screen is open. A host whose threads are still resyncing would make a delivered
 * conversation look missing, so delivery waits for "live".
 */
export function BotOutboxDrain() {
  const connected = useConnectedEnvironmentIds();
  const live = useAtomValue(liveShellEnvironmentIdsAtom);
  // Lets a bot chat still queue after a reload that finds its host unreachable.
  useRememberSessionGrants(connected);
  useEffect(() => {
    void botOutbox.start();
  }, []);
  useEffect(() => {
    botOutbox.setDeliverableEnvironments(new Set(connected.filter((id) => live.has(id))));
  }, [connected, live]);
  return null;
}
