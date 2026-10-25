import { useState } from "react";
import { useEnvironments } from "../../state/environments";
import { SettingsScopeProvider } from "./SettingsScopeContext";
import {
  botDefaultsPatch,
  botRuntimeSettingsUpdateMessage,
  botTurnOverridePatch,
  resolveBotTurnReadiness,
} from "@t3tools/client-runtime/bot-turn-settings";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";

import type { BotOutboxItem } from "../../botOutbox/botOutbox.logic";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import {
  useEnvironmentSupportsBotRuntimeSettings,
  useProjects,
  useServerConfigs,
} from "../../state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { BotAvatar } from "../bots/BotAvatar";
import {
  BotModelPicker,
  BotPermissionsSelect,
  botModelLabel,
  newThreadFallback,
  useEnvironmentBotProviders,
} from "../bots/BotRuntimeSettings";
import {
  botOutboxItemPreview,
  botOutboxItemText,
  cancelBotOutboxItem,
  useRemovedMachineBotOutboxItems,
} from "../bots/BotOutboxQueue";
import { partitionEnvironmentBots } from "../bots/botRoom.logic";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export function BotSettingsPanel() {
  const { environments } = useEnvironments();
  const [advanced, setAdvanced] = useState(false);
  const targets = environments.filter(
    (entry) => entry.serverConfig?.environment.capabilities.botConversations === true,
  );
  const render = (advanced: boolean) =>
    targets.map((environment) => (
      <SettingsScopeProvider
        key={environment.environmentId}
        search={{ machine: environment.environmentId }}
        onChange={() => {}}
        singleEnvironment
      >
        <BotSettingsContent
          environmentId={environment.environmentId}
          label={environment.label}
          connected={environment.connection.phase === "connected"}
          advanced={advanced}
        />
      </SettingsScopeProvider>
    ));
  return (
    <SettingsPageContainer>
      <p className="px-4 text-sm text-muted-foreground">
        Each bot's profile controls its model and permissions. Changes apply from its next message.
      </p>
      {targets.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">
          Connect to your bots to change their settings.
        </p>
      ) : null}
      <SettingsSection id="bot-overrides" title="Bots">
        {render(false)}
      </SettingsSection>
      <div>
        <Button variant="outline" size="sm" onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Hide advanced settings" : "Advanced settings"}
        </Button>
      </div>
      {advanced ? render(true) : null}
      <RemovedMachineUnsentMessages />
    </SettingsPageContainer>
  );
}

function BotSettingsContent({
  environmentId,
  label,
  connected,
  advanced,
}: {
  environmentId: EnvironmentId;
  label: string;
  connected: boolean;
  advanced: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentBotProviders(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const supported = useEnvironmentSupportsBotRuntimeSettings(environmentId);
  const projects = useProjects();
  const { assistant, extraAssistants, specialists } = partitionEnvironmentBots(
    projects,
    environmentId,
  );
  const bots = [...(assistant ? [assistant] : []), ...extraAssistants, ...specialists];
  const disabled = !connected || !canWrite || !supported;
  const defaults = settings.botDefaults;
  const newThread = newThreadFallback(settings, providers);
  const shownModel = defaults.defaultModelSelection ?? newThread?.modelSelection ?? null;
  const readiness =
    shownModel === null
      ? null
      : resolveBotTurnReadiness({
          settings,
          projectId: null,
          fallback: {
            modelSelection: shownModel,
            runtimeMode: newThread?.runtimeMode ?? "full-access",
          },
          providers,
        });

  return (
    <div className="flex flex-col gap-4">
      {advanced ? <h3 className="px-4 text-sm font-semibold">{label}</h3> : null}
      {connected && !supported ? (
        <p role="status" className="max-w-2xl px-3 text-xs text-warning-foreground sm:px-4">
          {botRuntimeSettingsUpdateMessage(label)}
        </p>
      ) : null}
      {advanced ? (
        <SettingsSection id={`bot-defaults-${environmentId}`} title="Defaults for bots">
          <SettingsRow
            serverScoped
            settingKeys={["botDefaults"]}
            id="bot-defaults-model"
            title="Model"
            description={
              defaults.defaultModelSelection === null
                ? "Not set: new bots start with the model for new threads, and existing bots keep theirs."
                : "Every bot without its own model uses this, including reasoning."
            }
            status={
              readiness?.kind === "setup-needed" ? (
                <span className="text-warning-foreground">{`Setup needed: ${readiness.reason}`}</span>
              ) : null
            }
            resetAction={
              defaults.defaultModelSelection !== null ? (
                <SettingResetButton
                  label="default bot model"
                  tooltip="Let each bot keep its current model"
                  disabled={disabled}
                  onClick={() =>
                    updateSettings(botDefaultsPatch(settings, { defaultModelSelection: null }))
                  }
                />
              ) : null
            }
            control={
              shownModel ? (
                <BotModelPicker
                  environmentId={environmentId}
                  projectId={null}
                  settings={settings}
                  providers={providers}
                  selection={shownModel}
                  disabled={disabled}
                  onChange={(defaultModelSelection) =>
                    updateSettings(botDefaultsPatch(settings, { defaultModelSelection }))
                  }
                />
              ) : (
                <span className="text-sm text-muted-foreground">No providers available</span>
              )
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["botDefaults"]}
            id="bot-defaults-permissions"
            title="Permissions"
            description="What bots may do without asking."
            control={
              <BotPermissionsSelect
                value={defaults.defaultRuntimeMode}
                inheritedLabel="Not set · each bot keeps its own"
                ariaLabel="Default bot permissions"
                disabled={disabled}
                onChange={(defaultRuntimeMode) =>
                  updateSettings(botDefaultsPatch(settings, { defaultRuntimeMode }))
                }
              />
            }
          />
        </SettingsSection>
      ) : null}
      {!advanced && bots.length > 0 ? (
        <div>
          {bots.map((bot) => {
            const own = settings.projectSettingsOverrides[bot.id];
            const ownParts = [
              own?.defaultModelSelection
                ? botModelLabel(own.defaultModelSelection, providers)
                : null,
              own?.defaultRuntimeMode ? runtimeModeConfig[own.defaultRuntimeMode].label : null,
            ].filter((part) => part !== null);
            return (
              <SettingsRow
                key={bot.id}
                serverScoped
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <BotAvatar bot={bot} />
                    <span className="truncate">{bot.title}</span>
                  </span>
                }
                description={
                  ownParts.length > 0
                    ? `Own setting: ${ownParts.join(" · ")}`
                    : "Uses the defaults. Set its own from its profile."
                }
                resetAction={
                  ownParts.length > 0 ? (
                    <SettingResetButton
                      label={`${bot.title} model and permissions`}
                      tooltip="Use the defaults"
                      disabled={disabled}
                      onClick={() =>
                        updateSettings(
                          botTurnOverridePatch(settings, bot.id, {
                            modelSelection: null,
                            runtimeMode: null,
                          }),
                        )
                      }
                    />
                  ) : null
                }
              />
            );
          })}
        </div>
      ) : null}
      {advanced ? (
        <SettingsSection id={`bot-advanced-${environmentId}`} title="Hosting">
          <SettingsRow
            serverScoped
            settingKeys={["defaultBotEnvironmentId"]}
            id="bot-default-host"
            title="Default host for new bots"
            description={`Saved on ${label}, so every device connected to it shares it. Only bots you create while ${label} hosts your Assistant go there; Assistant and existing bots stay where they are.`}
            control={
              <DefaultBotHostSelect
                environmentId={environmentId}
                label={label}
                value={settings.defaultBotEnvironmentId}
                disabled={disabled}
                onChange={(defaultBotEnvironmentId) => updateSettings({ defaultBotEnvironmentId })}
              />
            }
          />
        </SettingsSection>
      ) : null}
    </div>
  );
}

/** Messages queued for bots on a machine since removed from this app, so no chat lists them. */
function RemovedMachineUnsentMessages() {
  const items = useRemovedMachineBotOutboxItems();
  if (items.length === 0) return null;
  return (
    <SettingsSection id="bot-unsent-removed-machines" title="Unsent messages">
      <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        These were written to bots on a machine this app no longer connects to. Add that machine
        back to send them, or copy what you need and discard them.
      </p>
      {items.map((item) => (
        <RemovedMachineUnsentMessage key={item.messageId} item={item} />
      ))}
    </SettingsSection>
  );
}

function RemovedMachineUnsentMessage({ item }: { item: BotOutboxItem }) {
  const text = botOutboxItemText(item);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <SettingsRow
      title={<span className="block truncate">{botOutboxItemPreview(item) || "Message"}</span>}
      description={
        item.uncertain
          ? "Not confirmed: it may already have reached that machine."
          : "Not sent: its machine was removed."
      }
      control={
        <div className="flex items-center gap-1.5">
          {text ? (
            <Button size="xs" variant="outline" onClick={() => copyToClipboard(text)}>
              {isCopied ? "Copied" : "Copy text"}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => cancelBotOutboxItem(item.messageId)}>
            Discard
          </Button>
        </div>
      }
    />
  );
}

const THIS_ENVIRONMENT = "this-environment";

function DefaultBotHostSelect({
  environmentId,
  label,
  value,
  disabled,
  onChange,
}: {
  environmentId: EnvironmentId;
  label: string;
  value: EnvironmentId | null;
  disabled: boolean;
  onChange: (value: EnvironmentId | null) => void;
}) {
  const identities = useEnvironmentIdentities();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const configs = useServerConfigs();
  const others = identities
    .filter((identity) => identity.environmentId !== environmentId)
    .map((identity) => {
      const capabilities = configs.get(identity.environmentId)?.environment.capabilities;
      const note = !connectedEnvironmentIds.includes(identity.environmentId)
        ? " · offline"
        : capabilities?.botConversations !== true
          ? " · needs a newer server"
          : "";
      return { value: identity.environmentId, label: `${identity.label}${note}` };
    });
  // Another device may have picked an environment this one has never connected to.
  const unknown =
    value !== null && value !== environmentId && !others.some((item) => item.value === value)
      ? [{ value, label: "Not connected to this device" }]
      : [];
  const hosts = [...others, ...unknown];
  const items = [{ value: THIS_ENVIRONMENT, label: `This environment · ${label}` }, ...hosts];
  return (
    <Select
      value={value === null || value === environmentId ? THIS_ENVIRONMENT : value}
      items={items}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === THIS_ENVIRONMENT) onChange(null);
        else {
          const host = hosts.find((candidate) => candidate.value === next);
          if (host) onChange(host.value);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Default host for new bots">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
