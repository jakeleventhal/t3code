import {
  resolveBotTurnReadiness,
  type BotTurnReadiness,
} from "@t3tools/client-runtime/bot-turn-settings";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import {
  NO_PROVIDER_MODEL_SELECTION,
  resolveDefaultProviderModelSelection,
} from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { botEnvironment } from "../../state/bots";
import {
  readEnvironmentSupportsBotConversations,
  readThreadShell,
  waitForThreadShell,
} from "../../state/entities";
import { environmentPresentations, environmentSummaries } from "../../state/presentation";
import { environmentServerConfigsAtom } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { timelineSourceNavigation } from "../../lib/timelineSourceNavigation";
import { buildThreadRouteParams } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useBotRoomStore } from "./botRoomStore";

export interface BotTurnDefaults {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

type BotTurnDefaultsResult =
  | { readonly kind: "ready"; readonly defaults: BotTurnDefaults }
  | { readonly kind: "setup-needed"; readonly reason: string }
  | { readonly kind: "no-provider" };

/**
 * Read at call time, as new threads do: these maps change on every provider status push. With no
 * bot default or override this is the new-thread model; a configured one is used as chosen or
 * reported, never swapped for whichever provider happens to be ready.
 */
function readBotTurnDefaults(
  environmentId: EnvironmentId,
  project: EnvironmentProject | null,
): BotTurnDefaultsResult {
  const settings =
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
    DEFAULT_SERVER_SETTINGS;
  const providers =
    appAtomRegistry.get(environmentPresentations.providersByEnvironmentAtom).get(environmentId) ??
    [];
  const resolved = resolveProjectSettings(settings, project?.id ?? null, project).settings;
  const fallbackSelection = resolveDefaultProviderModelSelection(
    providers,
    resolved.defaultModelSelection,
  );
  const readiness = resolveBotTurnReadiness({
    settings,
    projectId: project?.id ?? null,
    fallback: {
      modelSelection: fallbackSelection ?? NO_PROVIDER_MODEL_SELECTION,
      runtimeMode: resolved.defaultRuntimeMode,
    },
    providers,
  });
  if (readiness.kind === "setup-needed") return { kind: "setup-needed", reason: readiness.reason };
  if (readiness.source === "inherited" && fallbackSelection === null)
    return { kind: "no-provider" };
  return {
    kind: "ready",
    defaults: {
      modelSelection: readiness.modelSelection,
      runtimeMode: readiness.runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    },
  };
}

/**
 * A bot's next turn, read at Send: its own model and permissions, else the bot defaults, else the
 * conversation's current ones.
 */
export function readBotSendSettings(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  thread: { readonly modelSelection: ModelSelection; readonly runtimeMode: RuntimeMode },
): BotTurnReadiness {
  return resolveBotTurnReadiness({
    settings:
      appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
      DEFAULT_SERVER_SETTINGS,
    projectId,
    fallback: thread,
    providers:
      appAtomRegistry.get(environmentPresentations.providersByEnvironmentAtom).get(environmentId) ??
      [],
  });
}

function reportBotFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

function reportBotSetupNeeded(title: string, reason: string, openBotSettings: () => void) {
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title,
      description: `Setup needed: ${reason} Choose another model in Bot settings, or set up the provider.`,
      actionProps: {
        children: "Bot settings",
        onClick: openBotSettings,
      },
    }),
  );
}

export const DISCONNECTED_MESSAGE =
  "This environment isn’t connected. Try again once it reconnects.";
const NO_PROVIDER_MESSAGE = "No provider is ready on this environment. Check Settings → Providers.";
export const BOTS_UNSUPPORTED_MESSAGE =
  "This environment’s T3 Code server doesn’t support bots yet. Update it to use them.";
// The command committed but the thread list hasn't caught up, often a dropped connection. Its
// route would treat the thread as missing, so wait for a retry, which resolves to the same one.
const NOT_SYNCED_MESSAGE = "It hasn’t synced to this window yet. Try again shortly.";

export function useBotActions() {
  const navigate = useNavigate();
  const openBot = useAtomCommand(botEnvironment.open, { reportFailure: false });
  const createBot = useAtomCommand(botEnvironment.create, { reportFailure: false });
  const setupNeeded = (title: string, environmentId: EnvironmentId, reason: string) =>
    reportBotSetupNeeded(title, reason, () => {
      void navigate({ to: "/settings/bots", search: { machine: environmentId } });
    });

  /** `sourceEntryId` opens the thread at that message or result instead of where it was left. */
  const openThread = async (
    threadRef: ScopedThreadRef,
    options?: { fromCode?: boolean; sourceEntryId?: string | null },
  ) => {
    useBotRoomStore
      .getState()
      .setReturnToCodeThreadKey(options?.fromCode ? scopedThreadKey(threadRef) : null);
    await navigate(
      options?.sourceEntryId
        ? timelineSourceNavigation(threadRef, options.sourceEntryId)
        : { to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) },
    );
  };

  const provisionMainThread = async (
    environmentId: EnvironmentId,
    project: EnvironmentProject | null,
    title: string,
  ): Promise<ScopedThreadRef | null> => {
    const name = project?.title ?? "Assistant";
    if (
      !appAtomRegistry.get(environmentSummaries.connectedEnvironmentIdsAtom).includes(environmentId)
    ) {
      reportBotFailure(title, new Error(DISCONNECTED_MESSAGE));
      return null;
    }
    if (!readEnvironmentSupportsBotConversations(environmentId)) {
      reportBotFailure(title, new Error(BOTS_UNSUPPORTED_MESSAGE));
      return null;
    }
    const defaults = readBotTurnDefaults(environmentId, project);
    if (defaults.kind === "setup-needed") {
      setupNeeded(title, environmentId, defaults.reason);
      return null;
    }
    if (defaults.kind === "no-provider") {
      reportBotFailure(title, new Error(NO_PROVIDER_MESSAGE));
      return null;
    }
    const result = await openBot({
      environmentId,
      input: {
        ...defaults.defaults,
        ...(project ? { projectId: project.id } : {}),
        creationSource: "web",
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        reportBotFailure(title, squashAtomCommandFailure(result));
      }
      return null;
    }
    const ref = scopeThreadRef(environmentId, result.value.threadId);
    if (!(await waitForThreadShell(ref))) {
      reportBotFailure(`${name} isn’t ready yet`, new Error(NOT_SYNCED_MESSAGE));
      return null;
    }
    return ref;
  };

  /**
   * Resolves a bot's main conversation, creating Assistant or the main thread only when the
   * server has none. A main thread already on screen opens directly, so read-only connections
   * and older servers can still read it. Failures are reported here and resolve to null.
   */
  const ensureMainThread = async (
    environmentId: EnvironmentId,
    project: EnvironmentProject | null,
  ): Promise<ScopedThreadRef | null> => {
    const mainThreadId = project?.botMainThreadId ?? null;
    const canOperate = readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
    if (mainThreadId !== null) {
      const ref = scopeThreadRef(environmentId, mainThreadId);
      const shell = readThreadShell(ref);
      // An archived main goes through bots.open, which unarchives it. A connection that cannot
      // write still gets to read it.
      if (
        shell !== null &&
        shell.deletedAt === null &&
        (shell.archivedAt === null || !canOperate)
      ) {
        return ref;
      }
    }
    const title = project ? `Could not open ${project.title}` : "Could not open Assistant";
    try {
      return await provisionMainThread(environmentId, project, title);
    } catch (error) {
      reportBotFailure(title, error);
      return null;
    }
  };

  /** Never rejects, so callers can clear their busy state after awaiting it. */
  const openMainConversation = async (
    environmentId: EnvironmentId,
    project: EnvironmentProject | null,
    options?: { fromCode?: boolean },
  ): Promise<boolean> => {
    const ref = await ensureMainThread(environmentId, project);
    if (ref === null) return false;
    try {
      await openThread(ref, options);
      return true;
    } catch (error) {
      reportBotFailure(
        project ? `Could not open ${project.title}` : "Could not open Assistant",
        error,
      );
      return false;
    }
  };

  /**
   * Retrying with the same commandId after any failure resolves to the same bot. Never rejects.
   */
  const createSpecialist = async (input: {
    readonly environmentId: EnvironmentId;
    readonly name: string;
    readonly commandId: CommandId;
  }): Promise<boolean> => {
    const { environmentId, name, commandId } = input;
    const title = "Could not create the bot";
    try {
      if (!readEnvironmentSupportsBotConversations(environmentId)) {
        reportBotFailure(title, new Error(BOTS_UNSUPPORTED_MESSAGE));
        return false;
      }
      const defaults = readBotTurnDefaults(environmentId, null);
      if (defaults.kind === "setup-needed") {
        setupNeeded(title, environmentId, defaults.reason);
        return false;
      }
      if (defaults.kind === "no-provider") {
        reportBotFailure(title, new Error(NO_PROVIDER_MESSAGE));
        return false;
      }
      const result = await createBot({
        environmentId,
        input: {
          ...defaults.defaults,
          commandId,
          name,
          creationSource: "web",
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportBotFailure(title, squashAtomCommandFailure(result));
        }
        return false;
      }
      const ref = scopeThreadRef(environmentId, result.value.threadId);
      if (!(await waitForThreadShell(ref))) {
        reportBotFailure(`${name} isn’t ready yet`, new Error(NOT_SYNCED_MESSAGE));
        return false;
      }
      await openThread(ref);
      return true;
    } catch (error) {
      reportBotFailure(title, error);
      return false;
    }
  };

  return { ensureMainThread, openMainConversation, openThread, createSpecialist };
}
