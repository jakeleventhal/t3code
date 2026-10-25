import { useNavigation } from "@react-navigation/native";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { useAssistantEnvironmentId } from "./use-assistant";
import { useBotAvailability } from "./use-bot-conversation";

/**
 * The Bots list's search text, or null while it is not searching. The header opens it from
 * outside the list, so it lives here rather than in the list's state.
 */
export const botsSearchQueryAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile-bots:search"),
);

export function setBotsSearchQuery(query: string | null) {
  appAtomRegistry.set(botsSearchQueryAtom, query);
}

/**
 * Search and New bot for the Bots header on every platform. New bots start on the Assistant's
 * environment, the same one the hero and the Chats orb use.
 */
export function useBotsHeaderActions() {
  const navigation = useNavigation();
  const environmentId = useAssistantEnvironmentId();
  const canCreate = useBotAvailability(environmentId).canStart;
  return {
    search: () => setBotsSearchQuery(appAtomRegistry.get(botsSearchQueryAtom) === null ? "" : null),
    newBot:
      environmentId === null || !canCreate
        ? null
        : () => navigation.navigate("NewBot", { environmentId: String(environmentId) }),
  };
}
