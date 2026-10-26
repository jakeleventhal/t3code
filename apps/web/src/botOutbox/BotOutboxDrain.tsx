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
  // oxlint-disable-next-line t3code/react-effect-budget -- Start the persisted delivery service when its app host mounts.
  useEffect(() => {
    void botOutbox.start();
  }, []);
  // oxlint-disable-next-line t3code/react-effect-budget -- Keep the external delivery service in sync with connected, live environments.
  useEffect(() => {
    botOutbox.setDeliverableEnvironments(new Set(connected.filter((id) => live.has(id))));
  }, [connected, live]);
  return null;
}
