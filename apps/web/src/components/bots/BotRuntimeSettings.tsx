import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  botModelUnavailableReason,
  botRuntimeSettingsUpdateMessage,
  botTurnOverridePatch,
  resolveBotTurnReadiness,
  type BotTurnReadiness,
} from "@t3tools/client-runtime/bot-turn-settings";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironmentSupportsBotRuntimeSettings, useThreadShell } from "../../state/entities";
import { useEnvironment, useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { TraitsPicker } from "../chat/TraitsPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useBotRoomStore } from "./botRoomStore";

export function useEnvironmentBotProviders(environmentId: EnvironmentId) {
  return useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
}

/** What a bot falls back to with nothing configured: the model new Code threads start with. */
export function newThreadFallback(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): { readonly modelSelection: ModelSelection; readonly runtimeMode: RuntimeMode } | null {
  const resolved = resolveProjectSettings(settings, null).settings;
  const modelSelection = resolveDefaultProviderModelSelection(
    providers,
    resolved.defaultModelSelection,
  );
  return modelSelection === null
    ? null
    : { modelSelection, runtimeMode: resolved.defaultRuntimeMode };
}

export function botModelLabel(
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): string {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === selection.model);
  const providerName = provider?.displayName ?? selection.instanceId;
  return `${model?.shortName ?? model?.name ?? selection.model} · ${providerName}`;
}

/**
 * What a bot's next message would run with, live. Before the bot exists only the bot defaults
 * apply; null means nothing to check yet.
 */
export function useBotSendReadiness(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
  thread: { readonly modelSelection: ModelSelection; readonly runtimeMode: RuntimeMode } | null,
): BotTurnReadiness | null {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentBotProviders(environmentId);
  const fallback = thread
    ? { modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode }
    : newThreadFallback(settings, providers);
  return fallback === null
    ? null
    : resolveBotTurnReadiness({ settings, projectId, fallback, providers });
}

/** The provider, model and reasoning pickers new threads use, for one bot setting. */
export function BotModelPicker({
  environmentId,
  projectId,
  settings,
  providers,
  selection,
  disabled,
  placeholder,
  onChange,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  settings: UnifiedSettings;
  providers: ReadonlyArray<ServerProvider>;
  selection: ModelSelection;
  disabled: boolean;
  placeholder?: string;
  onChange: (selection: ModelSelection) => void;
}) {
  const navigate = useNavigate();
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, projectId),
  );
  const activeEntry = entries.find((entry) => entry.instanceId === selection.instanceId);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <ProviderModelPicker
        environmentId={environmentId}
        {...(placeholder ? { triggerLabel: placeholder } : {})}
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={getCustomModelOptionsByInstance(
          settings,
          providers,
          selection.instanceId,
          selection.model,
        )}
        disabled={disabled}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        getModelDisabledReason={(instanceId, model) =>
          botModelUnavailableReason(settings, projectId, { instanceId, model }, providers)
        }
        onOpenProviderSetup={(instanceId) =>
          void navigate({ to: "/settings/providers", search: { environmentId, instanceId } })
        }
        onInstanceModelChange={(instanceId, model) =>
          onChange(createModelSelection(instanceId, model))
        }
      />
      {activeEntry && !placeholder ? (
        <TraitsPicker
          provider={activeEntry.driverKind}
          models={activeEntry.models}
          model={selection.model}
          modelOptions={selection.options ?? []}
          allowPromptInjectedEffort={false}
          planModeEnabled={settings.planModeEnabled}
          triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
          disabled={disabled}
          onModelOptionsChange={(options) =>
            onChange(createModelSelection(selection.instanceId, selection.model, options))
          }
        />
      ) : null}
    </div>
  );
}

const INHERIT = "inherit";

/** Permissions, where the first option follows whatever the bot would otherwise use. */
export function BotPermissionsSelect({
  value,
  inheritedLabel,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: RuntimeMode | null;
  inheritedLabel: string;
  ariaLabel: string;
  disabled: boolean;
  onChange: (value: RuntimeMode | null) => void;
}) {
  return (
    <Select
      value={value ?? INHERIT}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === INHERIT) onChange(null);
        else {
          const mode = runtimeModeOptions.find((option) => option === next);
          if (mode) onChange(mode);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label={ariaLabel}>
        <SelectValue>
          {(selected: RuntimeMode | typeof INHERIT | null) =>
            selected === null || selected === INHERIT
              ? inheritedLabel
              : runtimeModeConfig[selected].label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem value={INHERIT}>{inheritedLabel}</SelectItem>
        {runtimeModeOptions.map((mode) => {
          const option = runtimeModeConfig[mode];
          const Icon = option.icon;
          return (
            <SelectItem key={mode} value={mode} className="min-w-64">
              <div className="grid gap-0.5">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  {option.label}
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </SelectItem>
          );
        })}
      </SelectPopup>
    </Select>
  );
}

/** The bot chat's notice when its configured model can't run; Send stays off meanwhile. */
export function useBotSetupBanner(
  environmentId: EnvironmentId,
  readiness: BotTurnReadiness | null,
): ComposerBannerStackItem | null {
  const navigate = useNavigate();
  if (readiness?.kind !== "setup-needed") return null;
  return {
    id: `bot-setup:${readiness.instanceId}:${readiness.modelSelection.model}`,
    variant: "warning",
    icon: <TriangleAlertIcon />,
    title: "Setup needed",
    description: `${readiness.reason} No other model is swapped in.`,
    actions: (
      <>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            const room = useBotRoomStore.getState();
            room.setProfileTab("settings");
            room.setProfileOpen(true);
          }}
        >
          Choose model
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void navigate({
              to: "/settings/providers",
              search: { environmentId, instanceId: readiness.instanceId },
            })
          }
        >
          Set up provider
        </Button>
      </>
    ),
  };
}

export function BotSetupNeeded({
  environmentId,
  readiness,
  onUseDefault,
}: {
  environmentId: EnvironmentId;
  readiness: Extract<BotTurnReadiness, { kind: "setup-needed" }>;
  onUseDefault?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2.5 text-sm"
    >
      <p className="flex items-start gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <span>
          <span className="font-medium">Setup needed.</span> {readiness.reason} Sending stays off
          until it’s set up or another model is chosen; no other model is swapped in.
        </span>
      </p>
      <div className="flex flex-wrap justify-end gap-1.5">
        {onUseDefault ? (
          <Button size="xs" variant="ghost" onClick={onUseDefault}>
            Use default
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/settings/providers",
              search: { environmentId, instanceId: readiness.instanceId },
            })
          }
        >
          Set up provider
        </Button>
      </div>
    </div>
  );
}

/** The bot profile's Settings tab: this bot's own model and permissions, or the bot defaults. */
export function BotTurnSettingsPanel({
  project,
  connected,
}: {
  project: EnvironmentProject;
  connected: boolean;
}) {
  const environmentId = project.environmentId;
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentBotProviders(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const supported = useEnvironmentSupportsBotRuntimeSettings(environmentId);
  const environmentLabel = useEnvironment(environmentId)?.label ?? "This environment";
  const mainThread = useThreadShell(
    project.botMainThreadId ? scopeThreadRef(environmentId, project.botMainThreadId) : null,
  );
  const disabled = !connected || !canWrite || !supported;
  const own = settings.projectSettingsOverrides[project.id];
  const ownModel = own?.defaultModelSelection ?? null;
  const ownRuntime = own?.defaultRuntimeMode ?? null;
  const fallback = mainThread
    ? { modelSelection: mainThread.modelSelection, runtimeMode: mainThread.runtimeMode }
    : newThreadFallback(settings, providers);
  const readiness =
    fallback === null
      ? null
      : resolveBotTurnReadiness({ settings, projectId: project.id, fallback, providers });
  const defaults = settings.botDefaults;
  const inheritedModelLabel = defaults.defaultModelSelection
    ? `Default · ${botModelLabel(defaults.defaultModelSelection, providers)}`
    : "Default · keeps its current model";
  const inheritedRuntime = defaults.defaultRuntimeMode ?? fallback?.runtimeMode ?? null;
  const inheritedRuntimeLabel = inheritedRuntime
    ? `Default · ${runtimeModeConfig[inheritedRuntime].label}`
    : "Default";
  const configure = useAtomCommand(botEnvironment.configure);
  const write = (change: Parameters<typeof botTurnOverridePatch>[2]) =>
    configure({
      environmentId: project.environmentId,
      input: { runtimeOverride: { projectId: project.id, ...change } },
    });

  if (readiness === null) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {connected
          ? "No provider is ready on this environment. Set one up in Settings → Providers."
          : "Reconnect to this environment to change its settings."}
      </p>
    );
  }
  return (
    <section aria-label="Model and permissions" className="grid gap-4">
      {connected && !supported ? (
        <p role="status" className="px-1 text-xs leading-relaxed text-warning-foreground">
          {botRuntimeSettingsUpdateMessage(environmentLabel)}
        </p>
      ) : null}
      {readiness.kind === "setup-needed" ? (
        <BotSetupNeeded
          environmentId={environmentId}
          readiness={readiness}
          onUseDefault={ownModel && !disabled ? () => write({ modelSelection: null }) : undefined}
        />
      ) : null}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-xs text-muted-foreground">Model</h3>
          {ownModel ? (
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={disabled}
              onClick={() => write({ modelSelection: null })}
            >
              Use default
            </Button>
          ) : null}
        </div>
        <div className="grid gap-2 rounded-xl border bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">
            {ownModel ? `${project.title}’s own model` : inheritedModelLabel}
          </p>
          <BotModelPicker
            environmentId={environmentId}
            projectId={project.id}
            settings={settings}
            providers={providers}
            selection={readiness.modelSelection}
            disabled={disabled}
            onChange={(modelSelection) => write({ modelSelection })}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <h3 className="px-1 text-xs text-muted-foreground">Permissions</h3>
        <div className="flex justify-end rounded-xl border bg-card px-3 py-2.5">
          <BotPermissionsSelect
            value={ownRuntime}
            inheritedLabel={inheritedRuntimeLabel}
            ariaLabel={`${project.title} permissions`}
            disabled={disabled}
            onChange={(runtimeMode) => write({ runtimeMode })}
          />
        </div>
      </div>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        {"Changes apply from the next message. A reply already running keeps its settings. "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() =>
            void navigate({ to: "/settings/bots", search: { machine: environmentId } })
          }
        >
          Bot defaults
        </button>
      </p>
    </section>
  );
}
