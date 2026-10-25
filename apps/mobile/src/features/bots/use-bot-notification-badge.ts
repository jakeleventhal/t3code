import { useAtomValue } from "@effect/atom-react";
import { useProjects } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { botNotificationBadge } from "./bot-room";

export function useBotNotificationBadge() {
  const projects = useProjects();
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  return botNotificationBadge(projects, threads);
}
