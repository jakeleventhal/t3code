import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
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
import {
  resolveBotTurnReadiness,
  resolveNewBotHost,
  type NewBotHost,
} from "@t3tools/client-runtime/bot-turn-settings";
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
import { useBotHostCandidates } from "./use-assistant";

const NO_ENVIRONMENT_PERMISSION = Atom.make(false).pipe(
  Atom.withLabel("mobile-bots:no-environment"),
);

/**
 * Model settings for a conversation the server has to create, from the bot's own choice or the
 * bot defaults, else the environment's defaults for new threads. A configured model that can't
 * run here is reported, never swapped for another. `defaults` is null when nothing can run.
 */
function useBotConversationDefaults(environmentId: EnvironmentId | null) {
  const config = useEnvironmentServerConfig(environmentId);
  const sticky = useStickyComposerModelSelection();
  if (config === null) return { defaults: null, resolve: () => null };
  const serverSettings = config.settings ?? DEFAULT_SERVER_SETTINGS;
  const { settings } = resolveProjectSettings(serverSettings, null);
  const projectDefaultSelection = resolveDefaultableModelSelection(
    config,
    settings.defaultModelSelection,
    null,
  );
  const stickySelection = resolveDefaultableModelSelection(config, sticky, null);
  const environmentSelection = resolveNewTaskModelSelection({
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
  const fallbackSelection =
    environmentSelection ?? serverSettings.botDefaults.defaultModelSelection;
  if (fallbackSelection === null) return { defaults: null, resolve: () => null };
  const fallback = { modelSelection: fallbackSelection, runtimeMode: settings.defaultRuntimeMode };
  const resolve = (projectId: ProjectId | null) => {
    const readiness = resolveBotTurnReadiness({
      settings: serverSettings,
      projectId,
      fallback,
      providers: config.providers,
    });
    return readiness.kind === "setup-needed"
      ? readiness
      : {
          kind: "ready" as const,
          input: {
            modelSelection: readiness.modelSelection,
            runtimeMode: readiness.runtimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            creationSource: "mobile" as const,
          },
        };
  };
  return { defaults: fallback, resolve };
}

/** Says why a bot can't start and offers its model settings instead of picking another model. */
function useReportSetupNeeded(environmentId: EnvironmentId | null) {
  const navigation = useNavigation();
  return (title: string, reason: string, projectId: ProjectId | null) => {
    if (environmentId === null) return;
    Dialog.alert(`${title} needs setup`, `${reason} Choose a model that’s set up here.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Bot settings",
        onPress: () =>
          navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: {
              screen: "SettingsBotTurn",
              params: { environmentId, ...(projectId === null ? {} : { projectId }) },
            },
          }),
      },
    ]);
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
  const { defaults, resolve } = useBotConversationDefaults(environmentId);
  const reportSetupNeeded = useReportSetupNeeded(environmentId);
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
      const settings = resolve(input.projectId);
      if (settings === null) {
        reportFailure(
          `Can’t open ${input.title}`,
          "No model is available on this environment. Set up a provider, then try again.",
        );
        return null;
      }
      if (settings.kind === "setup-needed") {
        reportSetupNeeded(input.title, settings.reason, input.projectId);
        return null;
      }
      inFlight.current = true;
      setPending(true);
      const result = await open({
        environmentId,
        input: {
          ...settings.input,
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
    [canStart, reason, resolve, reportSetupNeeded, environmentId, open],
  );
  return { open: run, pending, canStart, reason, defaults };
}

/**
 * Where a new bot goes: the default host saved on the Assistant's environment, else that
 * environment. Null until there is an Assistant environment.
 */
function useNewBotHost(sourceEnvironmentId: EnvironmentId | null): NewBotHost | null {
  const config = useEnvironmentServerConfig(sourceEnvironmentId);
  const candidates = useBotHostCandidates();
  if (sourceEnvironmentId === null) return null;
  return resolveNewBotHost({
    sourceEnvironmentId,
    defaultBotEnvironmentId: config?.settings.defaultBotEnvironmentId ?? null,
    environments: candidates,
  });
}

/**
 * Creates a specialist on the default host for new bots, with that host's own model settings.
 * An unavailable host is reported; the bot never lands somewhere else instead.
 */
export function useCreateBot(sourceEnvironmentId: EnvironmentId | null) {
  const host = useNewBotHost(sourceEnvironmentId);
  const environmentId = host?.kind === "ready" ? host.environmentId : null;
  const { defaults, resolve } = useBotConversationDefaults(environmentId);
  const reportSetupNeeded = useReportSetupNeeded(environmentId);
  const create = useAtomCommand(botEnvironment.create, {
    label: "bots create",
    reportFailure: false,
  });
  // A retry after a failure reuses the id, so a lost response cannot create a second bot. A
  // success retires it so the next bot is a new command.
  const commandId = useRef(CommandId.make(uuidv4()));
  const run = useCallback(
    async (name: string) => {
      if (host?.kind === "unavailable") {
        reportFailure("Can’t create bot", host.reason);
        return null;
      }
      const settings = resolve(null);
      if (environmentId === null || settings === null) return null;
      if (settings.kind === "setup-needed") {
        reportSetupNeeded("This bot", settings.reason, null);
        return null;
      }
      const result = await create({
        environmentId,
        input: { ...settings.input, commandId: commandId.current, name },
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
    [create, host, resolve, reportSetupNeeded, environmentId],
  );
  const settings = resolve(null);
  return {
    create: run,
    host,
    environmentId,
    ready: defaults !== null,
    setupNeeded: settings?.kind === "setup-needed" ? settings.reason : null,
  };
}
