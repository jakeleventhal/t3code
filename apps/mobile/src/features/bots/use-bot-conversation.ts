import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { Atom } from "effect/reactivity";
import { useCallback, useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
} from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { useStickyComposerModelSelection } from "../../state/use-composer-drafts";

const NO_ENVIRONMENT_PERMISSION = Atom.make(false).pipe(
  Atom.withLabel("mobile-bots:no-environment"),
);

/**
 * Model settings for a conversation the server has to create. They only seed new conversations;
 * an existing one keeps its own model, which is changed from the chat like any thread.
 */
function useBotConversationDefaults(environmentId: EnvironmentId | null) {
  const config = useEnvironmentServerConfig(environmentId);
  const sticky = useStickyComposerModelSelection();
  if (config === null) return null;
  const { settings } = resolveProjectSettings(config.settings ?? DEFAULT_SERVER_SETTINGS, null);
  const projectDefaultSelection = resolveDefaultableModelSelection(
    config,
    settings.defaultModelSelection,
    null,
  );
  const stickySelection = resolveDefaultableModelSelection(config, sticky, null);
  const modelSelection = resolveNewTaskModelSelection({
    draftSelection: null,
    projectDefaultSelection,
    stickySelection,
    modelOptions: buildModelOptions(
      config,
      projectDefaultSelection ?? stickySelection,
      undefined,
      null,
    ),
  });
  return modelSelection === null
    ? null
    : {
        modelSelection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        creationSource: "mobile" as const,
      };
}

function reportFailure(title: string, detail: string) {
  Dialog.alert(title, detail);
}

const UNSUPPORTED_REASON = "This environment’s T3 server needs an update to use bots.";
const READ_ONLY_REASON = "This device has read-only access to the environment.";

/**
 * Whether this device may create or reopen bot conversations on an environment, and why not.
 * Older servers don't advertise bots; their conversations that are already loaded stay readable.
 */
export function useBotAvailability(environmentId: EnvironmentId | null) {
  const supported =
    useEnvironmentServerConfig(environmentId)?.environment.capabilities.botConversations === true;
  const permitted = useAtomValue(
    environmentId === null
      ? NO_ENVIRONMENT_PERMISSION
      : botEnvironment.open.permissionAtom(environmentId),
  );
  return {
    canStart: supported && permitted,
    reason: !supported ? UNSUPPORTED_REASON : !permitted ? READ_ONLY_REASON : null,
  };
}

/**
 * Opens a bot's main conversation. A conversation this client already has opens directly, which
 * also works with read-only access; anything else asks the server, which creates the Assistant
 * on first use. An archived main conversation also goes through the server, which unarchives it,
 * unless this device can only read. Nothing here runs without a user action.
 */
export function useOpenBotConversation(environmentId: EnvironmentId | null) {
  const defaults = useBotConversationDefaults(environmentId);
  const { canStart, reason } = useBotAvailability(environmentId);
  const open = useAtomCommand(botEnvironment.open, {
    label: "bots open",
    reportFailure: false,
  });
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (input: {
      readonly projectId: ProjectId | null;
      readonly known: { readonly id: ThreadId; readonly archived: boolean } | null;
      readonly title: string;
    }): Promise<{ readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null> => {
      if (environmentId === null) return null;
      if (input.known !== null && (!input.known.archived || !canStart)) {
        return { environmentId, threadId: input.known.id };
      }
      if (inFlight.current) return null;
      if (!canStart) {
        reportFailure(`Can’t open ${input.title}`, reason ?? READ_ONLY_REASON);
        return null;
      }
      if (defaults === null) {
        reportFailure(
          `Can’t open ${input.title}`,
          "No model is available on this environment. Set up a provider, then try again.",
        );
        return null;
      }
      inFlight.current = true;
      setPending(true);
      const result = await open({
        environmentId,
        input: {
          ...defaults,
          ...(input.projectId === null ? {} : { projectId: input.projectId }),
        },
      });
      inFlight.current = false;
      setPending(false);
      if (result._tag === "Success") return { environmentId, threadId: result.value.threadId };
      if (!isAtomCommandInterrupted(result)) {
        reportFailure(`Can’t open ${input.title}`, String(squashAtomCommandFailure(result)));
      }
      return null;
    },
    [canStart, reason, defaults, environmentId, open],
  );
  return { open: run, pending, canStart, reason, defaults };
}

export function useCreateBot(environmentId: EnvironmentId | null) {
  const defaults = useBotConversationDefaults(environmentId);
  const create = useAtomCommand(botEnvironment.create, {
    label: "bots create",
    reportFailure: false,
  });
  // A retry after a failure reuses the id, so a lost response cannot create a second bot. A
  // success retires it so the next bot is a new command.
  const commandId = useRef(CommandId.make(uuidv4()));
  const run = useCallback(
    async (name: string) => {
      if (environmentId === null || defaults === null) return null;
      const result = await create({
        environmentId,
        input: { ...defaults, commandId: commandId.current, name },
      });
      if (result._tag === "Success") {
        commandId.current = CommandId.make(uuidv4());
        return { environmentId, ...result.value };
      }
      if (!isAtomCommandInterrupted(result)) {
        reportFailure("Can’t create bot", String(squashAtomCommandFailure(result)));
      }
      return null;
    },
    [create, defaults, environmentId],
  );
  return { create: run, ready: defaults !== null };
}
