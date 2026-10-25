import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { environmentThreadShells } from "../../state/threads";
import { botSecondaryThreadCount } from "./bot-room";

/**
 * The count on a bot chat's Threads button. Each value is selected as a primitive so a streaming
 * turn, which rewrites shells many times a second, re-renders the header only when it changes.
 */
export function useBotThreadBadge(
  project: Pick<EnvironmentProject, "environmentId" | "id" | "botMainThreadId"> | null,
) {
  const open = useAtomValue(environmentThreadShells.navigationThreadShellsAtom, (threads) =>
    project === null ? 0 : botSecondaryThreadCount(project, threads).open,
  );
  const needsYou = useAtomValue(environmentThreadShells.navigationThreadShellsAtom, (threads) =>
    project === null ? false : botSecondaryThreadCount(project, threads).needsYou,
  );
  return { open, needsYou };
}
