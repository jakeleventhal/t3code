import { useBotProjects } from "../bots/useBotRoom";
import { BotComplexModelSetting } from "./BotComplexModelSetting";
import { BotPrimaryMachineSettings } from "./BotPrimaryMachineSettings";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotVoiceSetting, VoiceSetupSettings } from "./VoiceSettings";
import { environmentAssistant } from "@t3tools/client-runtime/assistant-environment";
import { useDesignatedAssistantEnvironmentId } from "../bots/useBotRoom";
import { useEnvironments } from "../../state/environments";
import { SettingsScopeProvider } from "./SettingsScopeContext";
import {
  botRuntimeSettingsUpdateMessage,
  resolveBotTurnReadiness,
} from "@t3tools/client-runtime/bot-turn-settings";
import {
  AuthSettingsWriteScope,
  type ServerSettings,
  type EnvironmentId,
} from "@t3tools/contracts";

import type { BotOutboxItem } from "../../botOutbox/botOutbox.logic";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentSupportsBotRuntimeSettings } from "../../state/entities";
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
  useAllBotOutboxItems,
} from "../bots/BotOutboxQueue";
import { partitionEnvironmentBots } from "../bots/botRoom.logic";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { Button } from "../ui/button";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export function BotSettingsPanel() {
  const { environments } = useEnvironments();
  const primaryId = useDesignatedAssistantEnvironmentId();
  const targets = environments.filter(
    (entry) => entry.serverConfig?.environment.capabilities.botConversations === true,
  );
  const render = (advanced: boolean) =>
    targets
      .filter((environment) => !advanced || environment.environmentId === primaryId)
      .map((environment) => (
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
        Choose defaults for your bots, then customize individual bots when needed. Changes apply
        from the next message.
      </p>
      {targets.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">
          Connect to your bots to change their settings.
        </p>
      ) : null}
      <BotPrimaryMachineSettings />
      {render(true)}
      {render(false)}
      <VoiceSetupSettings />
      <UnsentMessages />
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
  const configureBots = useAtomCommand(botEnvironment.configure);
  const updateDefaults = async (defaults: ServerSettings["botDefaults"]) => {
    await configureBots({ environmentId, input: defaults });
  };
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const supported = useEnvironmentSupportsBotRuntimeSettings(environmentId);
  const projects = useBotProjects();
  const { assistant, extraAssistants, specialists } = partitionEnvironmentBots(
    projects,
    environmentId,
  );
  const designated = environmentAssistant(projects, useDesignatedAssistantEnvironmentId());
  const bots = [...(assistant ? [assistant] : []), ...extraAssistants, ...specialists].filter(
    (bot) =>
      bot.botRole !== "assistant" ||
      (bot.id === designated?.id && bot.environmentId === designated.environmentId),
  );
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
            title="Chat model"
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
                  onClick={() => void updateDefaults({ ...defaults, defaultModelSelection: null })}
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
                    void updateDefaults({ ...defaults, defaultModelSelection })
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
                  void updateDefaults({ ...defaults, defaultRuntimeMode })
                }
              />
            }
          />
          <BotVoiceSetting environmentId={environmentId} />
          <BotComplexModelSetting environmentId={environmentId} />
        </SettingsSection>
      ) : null}
      {!advanced && bots.length > 0 ? (
        <div>
          {bots.map((bot) => {
            const own = settings.projectSettingsOverrides[bot.id];
            const chatModel = own?.defaultModelSelection ?? shownModel;
            const ownParts = [
              own?.defaultModelSelection
                ? botModelLabel(own.defaultModelSelection, providers)
                : null,
              own?.defaultRuntimeMode ? runtimeModeConfig[own.defaultRuntimeMode].label : null,
            ].filter((part) => part !== null);
            return (
              <SettingsSection key={bot.id} title={bot.title} icon={<BotAvatar bot={bot} />}>
                <SettingsRow
                  title="Chat model"
                  description={
                    ownParts.length > 0 ? ownParts.join(" · ") : "Uses the shared defaults."
                  }
                  control={
                    chatModel ? (
                      <BotModelPicker
                        environmentId={environmentId}
                        projectId={bot.id}
                        settings={settings}
                        providers={providers}
                        selection={chatModel}
                        disabled={disabled}
                        onChange={(modelSelection) =>
                          configureBots({
                            environmentId,
                            input: { runtimeOverride: { projectId: bot.id, modelSelection } },
                          })
                        }
                      />
                    ) : (
                      <span>No providers available</span>
                    )
                  }
                  resetAction={
                    own?.defaultModelSelection ? (
                      <SettingResetButton
                        label={`${bot.title} chat model`}
                        tooltip="Use default"
                        disabled={disabled}
                        onClick={() =>
                          configureBots({
                            environmentId,
                            input: { runtimeOverride: { projectId: bot.id, modelSelection: null } },
                          })
                        }
                      />
                    ) : null
                  }
                />
                <BotComplexModelSetting environmentId={environmentId} projectId={bot.id} />
                <SettingsRow
                  title="Permissions"
                  control={
                    <BotPermissionsSelect
                      value={own?.defaultRuntimeMode ?? null}
                      inheritedLabel="Use default"
                      ariaLabel={`${bot.title} permissions`}
                      disabled={disabled}
                      onChange={(runtimeMode) =>
                        configureBots({
                          environmentId,
                          input: { runtimeOverride: { projectId: bot.id, runtimeMode } },
                        })
                      }
                    />
                  }
                />
                <BotVoiceSetting bot={bot} environmentId={environmentId} />
                <BotPrimaryMachineSettings bot={bot} />
              </SettingsSection>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function UnsentMessages() {
  const items = useAllBotOutboxItems();
  if (items.length === 0) return null;
  return (
    <SettingsSection id="bot-unsent-messages" title="Unsent messages">
      <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        These messages keep their original destination, even if a synced copy takes over new
        requests. Reconnect the original machine to finish sending them.
      </p>
      {items.map((item) => (
        <UnsentMessage key={item.messageId} item={item} />
      ))}
    </SettingsSection>
  );
}

function UnsentMessage({ item }: { item: BotOutboxItem }) {
  const text = botOutboxItemText(item);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <SettingsRow
      title={<span className="block truncate">{botOutboxItemPreview(item) || "Message"}</span>}
      description={
        item.uncertain
          ? "Not confirmed: it may already have reached that machine."
          : "Waiting to send to its original destination."
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
