import { botComplexTaskModel } from "@t3tools/shared/botPreferences";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBotProjects } from "../bots/use-assistant";
import { BotPrimaryMachineSettings } from "./BotPrimaryMachineSettings";
import { BotVoiceSettingsRow, VoiceEnvironmentOverview } from "./SettingsVoiceRouteScreen";
import { environmentAssistant } from "@t3tools/client-runtime/assistant-environment";
import { useAssistantEnvironmentId } from "../bots/use-assistant";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  botRuntimeSettingsUpdateMessage,
  supportsBotRuntimeSettings,
} from "@t3tools/client-runtime/bot-turn-settings";
import {
  AuthSettingsWriteScope,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { botRole } from "../bots/bot-room";
import { botHostChoices } from "../bots/bot-turn-settings";
import { BotAvatar } from "../bots/BotAvatar";
import { useBotHostCandidates } from "../bots/use-assistant";
import { useBotTurnSettings, type BotTurnSettingsChange } from "../bots/use-bot-turn-settings";
import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";
import { ThreadSettingsPickerScreen } from "../threads/ThreadSettingsSheet";
import { SettingsActionRow } from "./components/SettingsActionRow";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { useSettingsWriter } from "./useSettingsWriter";

const CHANGES_NOTE =
  "Changes apply from the next message. Work already running keeps its settings.";

type BotTurnRouteParams = {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly modelPurpose?: "complex";
};

function BotsScreen(props: {
  readonly title: string;
  readonly filter?: boolean;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const bottomClearance = useWorkspaceTabs()?.bottomClearance ?? 0;
  return (
    <>
      {props.filter ? <SettingsEnvironmentFilterHeader /> : null}
      <SettingsScreen
        title={props.title}
        trailing={props.filter ? <AndroidSettingsEnvironmentFilter /> : undefined}
      >
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, bottomClearance, 18) + 18,
          }}
        >
          {props.children}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function Muted(props: { readonly children: string }) {
  return <Text className="px-2 text-base text-foreground-muted">{props.children}</Text>;
}

function useEnvironmentBots(environmentId: EnvironmentId) {
  const projects = useBotProjects();
  const designated = environmentAssistant(projects, useAssistantEnvironmentId());
  return projects
    .filter(
      (project) =>
        project.environmentId === environmentId &&
        botRole(project) !== null &&
        (project.botRole !== "assistant" ||
          (project.id === designated?.id && project.environmentId === designated.environmentId)),
    )
    .sort(
      (left, right) =>
        Number(right.botRole === "assistant") - Number(left.botRole === "assistant") ||
        left.title.localeCompare(right.title),
    );
}

function useOpenBotTurnSettings() {
  const navigation = useNavigation();
  return (params: BotTurnRouteParams) =>
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: { screen: "SettingsBotTurn", params },
    });
}

export function SettingsBotsRouteScreen() {
  const { availableTargets } = useSettingsEnvironmentFilter();
  const assistantEnvironmentId = useAssistantEnvironmentId();
  const primary = availableTargets.find(
    (target) => target.environmentId === assistantEnvironmentId,
  );
  return (
    <BotsScreen title="Bots">
      <Muted>
        Choose shared defaults and each bot's voice. Changes apply from the next message.
      </Muted>
      <SettingsSection title="Bots">
        {availableTargets.map((target) => (
          <BotsEnvironmentOverview key={target.environmentId} target={target} advanced={false} />
        ))}
      </SettingsSection>
      {primary ? <BotsEnvironmentOverview target={primary} advanced /> : null}
      {availableTargets.map((target) => (
        <VoiceEnvironmentOverview key={target.environmentId} target={target} mode="advanced" />
      ))}
      <BotPrimaryMachineSettings />
    </BotsScreen>
  );
}

function BotsEnvironmentOverview(props: {
  readonly target: SettingsTarget;
  readonly advanced: boolean;
}) {
  const environmentId = props.target.environmentId;
  const defaults = useBotTurnSettings(environmentId, null);
  const bots = useEnvironmentBots(environmentId);
  const open = useOpenBotTurnSettings();
  return (
    <View className="gap-6">
      {!defaults.supported ? (
        <Muted>Update this environment to set up bots.</Muted>
      ) : (
        <>
          {props.advanced ? (
            <SettingsSection
              title="Defaults for bots"
              footer={
                defaults.updateMessage ??
                (defaults.setupNeeded
                  ? `Setup needed · ${defaults.setupNeeded}`
                  : "Bots use these unless they have their own.")
              }
            >
              <SettingsRow
                icon="sparkles"
                label="Chat model"
                value={defaults.modelLabel}
                valuePosition="below"
                onPress={() => open({ environmentId })}
              />
              <SettingsRow
                icon="sparkles"
                label="Complex-task model"
                value={
                  defaults.config
                    ? (botComplexTaskModel(defaults.config.settings.botSharedPreferences, null)
                        ?.model ?? "Choose a model")
                    : "Choose a model"
                }
                onPress={() => open({ environmentId })}
              />
              <SettingsRow
                icon="exclamationmark.shield"
                label="Permissions"
                value={defaults.runtimeModeLabel}
                valuePosition="below"
                onPress={() => open({ environmentId })}
              />
              <BotVoiceSettingsRow environmentId={environmentId} />
            </SettingsSection>
          ) : null}
          {!props.advanced && bots.length > 0 ? (
            <View>
              {bots.map((bot) => (
                <BotOverviewRow
                  key={bot.id}
                  environmentId={environmentId}
                  projectId={bot.id}
                  title={bot.title}
                  assistant={bot.botRole === "assistant"}
                />
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * Where new bots go while this environment hosts the Assistant. It is saved on this environment,
 * so every device using it shares the choice.
 */
function useBotDefaultHost(environmentId: EnvironmentId) {
  const config = useEnvironmentServerConfig(environmentId);
  const candidates = useBotHostCandidates();
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const writeSettings = useSettingsWriter();
  const [pending, setPending] = useState(false);
  const label =
    config?.environment.label ??
    candidates.find((candidate) => candidate.environmentId === environmentId)?.label ??
    "This environment";
  const editable = supportsBotRuntimeSettings(config?.environment.capabilities);
  const choices = botHostChoices({
    environmentId,
    label,
    stored: config?.settings.defaultBotEnvironmentId ?? null,
    candidates,
  });
  const save = async (value: EnvironmentId | null) => {
    if (config === null || !editable) return;
    setPending(true);
    await writeSettings([], [{ environmentId, patch: { defaultBotEnvironmentId: value } }]);
    setPending(false);
  };
  return {
    config,
    label,
    choices,
    selected: choices.find((choice) => choice.selected),
    disabled: !editable || !canWrite || pending,
    updateMessage: editable ? null : botRuntimeSettingsUpdateMessage(label),
    footer: `Saved on ${label}, so every device using it shares it. It applies only to new bots created while ${label} hosts your Assistant. Your Assistant and existing bots stay where they are.`,
    save,
  };
}

export function SettingsBotDefaultHostRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId }>) {
  const host = useBotDefaultHost(route.params.environmentId);
  if (host.config === null) {
    return (
      <BotsScreen title="Default host">
        <Muted>This environment isn't connected.</Muted>
      </BotsScreen>
    );
  }
  return (
    <BotsScreen title="Default host">
      {host.updateMessage ? <Muted>{host.updateMessage}</Muted> : null}
      <SettingsSection title="New bots are created on" footer={host.footer}>
        {host.choices.map((choice, index) => (
          <SettingsChoiceRow
            key={choice.value ?? "self"}
            label={choice.label}
            {...(choice.status === null ? {} : { description: choice.status })}
            selected={choice.selected}
            separated={index > 0}
            disabled={host.disabled}
            onPress={() => {
              if (!choice.selected) void host.save(choice.value);
            }}
          />
        ))}
      </SettingsSection>
    </BotsScreen>
  );
}

function BotOverviewRow(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly assistant: boolean;
}) {
  const turn = useBotTurnSettings(props.environmentId, props.projectId);
  const open = useOpenBotTurnSettings();
  return (
    <SettingsRow
      icon={props.assistant ? "sparkles" : "person.crop.circle"}
      label={props.title}
      value={turn.setupNeeded ? `Setup needed · ${turn.modelLabel}` : turn.modelLabel}
      valuePosition="below"
      onPress={() => open({ environmentId: props.environmentId, projectId: props.projectId })}
    />
  );
}

/** One bot's model and permissions, or the bot defaults when the route names no bot. */
export function SettingsBotTurnRouteScreen({ route }: StaticScreenProps<BotTurnRouteParams>) {
  const { environmentId, projectId } = route.params;
  const navigation = useNavigation();
  const turn = useBotTurnSettings(environmentId, projectId ?? null);
  const configureBots = useAtomCommand(botEnvironment.configure);
  const bot = useProjects().find(
    (project) => project.environmentId === environmentId && project.id === projectId,
  );
  const role = bot ? botRole(bot) : null;
  const forBot = projectId !== undefined;
  const title = forBot ? (bot?.title ?? "Bot") : "Bot defaults";
  if (turn.config === null || (forBot && (!bot || role === null))) {
    return (
      <BotsScreen title={title}>
        <Muted>
          {turn.config === null ? "This environment isn't connected." : "This bot isn't available."}
        </Muted>
      </BotsScreen>
    );
  }
  if (!turn.supported) {
    return (
      <BotsScreen title={title}>
        <Muted>Update this environment to choose a bot's model and permissions.</Muted>
      </BotsScreen>
    );
  }
  const disabled = !turn.editable || !turn.canWrite || turn.pending;
  const save = (change: BotTurnSettingsChange) => void turn.save(change);
  const { model, runtimeMode } = turn.sources;
  const followLabel = forBot ? "Use default" : "Automatic";
  return (
    <BotsScreen title={title}>
      {turn.updateMessage ? <Muted>{turn.updateMessage}</Muted> : null}
      {bot && role ? (
        <SettingsSection>
          <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
            <BotAvatar role={role} title={bot.title} size={32} project={bot} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text textRole="body" className="font-t3-medium text-foreground" numberOfLines={1}>
                {bot.title}
              </Text>
              <Text textRole="footnote" className="text-foreground-muted">
                {CHANGES_NOTE}
              </Text>
            </View>
          </View>
        </SettingsSection>
      ) : (
        <Muted>
          {`Bots without their own model and permissions use these. Automatic keeps each chat's own, and new bots start on this environment's default for new threads. ${CHANGES_NOTE}`}
        </Muted>
      )}
      <SettingsSection
        title="Chat model"
        footer={
          turn.setupNeeded
            ? `Setup needed · ${turn.setupNeeded} ${
                model.own === null
                  ? "Choose a model for this bot or fix the bot defaults."
                  : `Choose another model, ${forBot ? "use the default" : "go back to automatic"}, or set the provider up.`
              }`
            : undefined
        }
      >
        <SettingsRow
          icon="sparkles"
          label="Chat model"
          value={turn.modelLabel}
          valuePosition="below"
          disabled={disabled}
          onPress={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: {
                screen: "SettingsBotTurnModel",
                params: { environmentId, ...(projectId ? { projectId } : {}) },
              },
            })
          }
        />
        {model.own !== null ? (
          <SettingsActionRow
            icon="arrow.uturn.backward"
            label={followLabel}
            description={turn.followedModelLabel}
            disabled={disabled}
            onPress={() => save({ modelSelection: null })}
          />
        ) : null}
        {turn.setupNeeded ? (
          <SettingsRow
            icon="person.crop.circle"
            label="Provider accounts"
            target="SettingsProviderAccounts"
          />
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Complex tasks"
        footer="Difficult work can use this model while chat stays available."
      >
        <SettingsRow
          icon="sparkles"
          label="Complex-task model"
          value={
            botComplexTaskModel(turn.config.settings.botSharedPreferences, projectId ?? null)
              ?.model ?? (projectId ? "Use default" : "Choose a model")
          }
          onPress={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: {
                screen: "SettingsBotTurnModel",
                params: {
                  environmentId,
                  ...(projectId ? { projectId } : {}),
                  modelPurpose: "complex",
                },
              },
            })
          }
        />
        {(
          projectId
            ? turn.config.settings.botSharedPreferences.complexTaskModelOverrides?.[projectId]
            : turn.config.settings.botSharedPreferences.complexTaskModelSelection
        ) ? (
          <SettingsActionRow
            icon="arrow.uturn.backward"
            label={projectId ? "Use default" : "Turn off automatic escalation"}
            disabled={disabled}
            onPress={() =>
              void configureBots({
                environmentId,
                input: projectId
                  ? { complexTaskModelOverride: { projectId, selection: null } }
                  : { complexTaskModelSelection: null },
              })
            }
          />
        ) : null}
      </SettingsSection>
      <SettingsSection title="Voice">
        <BotVoiceSettingsRow environmentId={environmentId} {...(projectId ? { projectId } : {})} />
      </SettingsSection>
      {bot ? (
        <SettingsSection title="Primary machine">
          <BotPrimaryMachineSettings bot={bot} />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Permissions">
        <SettingsChoiceRow
          label={followLabel}
          description={turn.followedRuntimeModeLabel}
          selected={runtimeMode.own === null}
          disabled={disabled}
          onPress={() => {
            if (runtimeMode.own !== null) save({ runtimeMode: null });
          }}
        />
        {RUNTIME_MODE_CHOICES.map((choice) => (
          <SettingsChoiceRow
            key={choice.mode}
            label={choice.label}
            description={choice.description}
            selected={runtimeMode.own === choice.mode}
            separated
            disabled={disabled}
            onPress={() => {
              if (runtimeMode.own !== choice.mode) save({ runtimeMode: choice.mode });
            }}
          />
        ))}
      </SettingsSection>
      {forBot ? (
        <SettingsSection>
          <SettingsRow
            icon="slider.horizontal.3"
            label="Bot defaults"
            onPress={() =>
              navigation.navigate("SettingsSheet", {
                screen: "SettingsContent",
                params: { screen: "SettingsBotTurn", params: { environmentId } },
              })
            }
          />
        </SettingsSection>
      ) : null}
    </BotsScreen>
  );
}

/**
 * The thread settings picker, saving each pick as the bot's own model. Picks accumulate here
 * so a save still in flight when the next one is made can't be written back over.
 */
export function SettingsBotTurnModelRouteScreen({ route }: StaticScreenProps<BotTurnRouteParams>) {
  const { environmentId, projectId } = route.params;
  const navigation = useNavigation();
  const configure = useAtomCommand(botEnvironment.configure);
  const complex = route.params.modelPurpose === "complex";
  const turn = useBotTurnSettings(environmentId, projectId ?? null);
  const [picked, setPicked] = useState<{
    readonly modelSelection?: ModelSelection;
    readonly runtimeMode?: RuntimeMode;
  }>({});
  const { model, runtimeMode } = turn.sources;
  const selectedModel =
    picked.modelSelection ??
    (complex && turn.config
      ? botComplexTaskModel(turn.config.settings.botSharedPreferences, projectId ?? null)
      : null) ??
    model.own ??
    model.inherited;
  // With nothing chosen yet, show what a new bot would start on.
  const selectedRuntimeMode =
    picked.runtimeMode ??
    runtimeMode.own ??
    runtimeMode.inherited ??
    turn.config?.settings.defaultRuntimeMode ??
    DEFAULT_RUNTIME_MODE;
  const selectedOption = turn.modelOptions.find(
    (option) =>
      option.selection.instanceId === selectedModel?.instanceId &&
      option.selection.model === selectedModel.model,
  );
  const pick = (change: {
    readonly modelSelection?: ModelSelection;
    readonly runtimeMode?: RuntimeMode;
  }) => {
    const next = { ...picked, ...change };
    setPicked(next);
    if (complex && next.modelSelection) {
      void configure({
        environmentId,
        input: projectId
          ? { complexTaskModelOverride: { projectId, selection: next.modelSelection } }
          : { complexTaskModelSelection: next.modelSelection },
      });
    } else if (!complex) void turn.save(next);
  };
  return (
    <ThreadSettingsPickerScreen
      environmentId={environmentId}
      projectId={projectId ?? null}
      providerGroups={groupByProvider(turn.modelOptions)}
      selectedModel={selectedModel}
      prompt=""
      onPromptChange={() => {}}
      onSelectModel={(option) => pick({ modelSelection: option.selection })}
      optionDescriptors={resolveProviderOptionDescriptors({
        capabilities: selectedOption?.capabilities,
        selections: selectedModel?.options,
      })}
      onUpdateOptionSelections={(options) => {
        if (selectedModel) pick({ modelSelection: { ...selectedModel, options } });
      }}
      hideRuntimeMode={complex}
      runtimeMode={selectedRuntimeMode}
      onUpdateRuntimeMode={(mode) => pick({ runtimeMode: mode })}
      onClose={() => navigation.goBack()}
    />
  );
}
