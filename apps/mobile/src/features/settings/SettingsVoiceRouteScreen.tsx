import { openSettings } from "./settings-navigation";
import { botDefaultVoice } from "@t3tools/shared/botPreferences";
import { botEnvironment } from "../../state/bots";
import { useBotProjects } from "../bots/use-assistant";
import { useAssistantEnvironmentId } from "../bots/use-assistant";
import { environmentAssistant } from "@t3tools/client-runtime/assistant-environment";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useVoicePreview } from "../../voice/useVoicePreview";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
  type ServerSettingsPatch,
  type VoiceConnection,
  type VoiceSelection,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { botVoiceEnvironment } from "../../state/bot-voice";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { botRole } from "../bots/bot-room";
import { BotAvatar } from "../bots/BotAvatar";
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
import { resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";
import {
  botVoiceSource,
  firstVoiceSelection,
  isVoiceConnectionUsable,
  subscriptionVoiceSources,
  VOICE_CONNECTION_KINDS,
  voiceConnectionKindLabel,
  voiceConnectionPatch,
  voiceConnectionStatusLabel,
  voiceConnectionsSignature,
  voiceCallsNote,
  voiceSelectionLabel,
  type VoiceCatalogConnection,
  type VoiceConnectionKind,
} from "./voice-settings.logic";

function useVoiceEnvironment(environmentId: EnvironmentId) {
  const { availableTargets } = useSettingsEnvironmentFilter();
  const environment = availableTargets.find((entry) => entry.environmentId === environmentId);
  const supported =
    environment?.serverConfig.environment.capabilities.botVoiceConfiguration === true;
  const catalog = useEnvironmentQuery(
    supported ? botVoiceEnvironment.catalog({ environmentId, input: {} }) : null,
  );
  // Connections edited from any client reach us as settings; the catalog only follows on refresh.
  const signature = environment
    ? voiceConnectionsSignature(environment.serverConfig.settings.voiceConnections)
    : null;
  const seenSignature = useRef(signature);
  const refreshCatalog = catalog.refresh;
  useEffect(() => {
    if (seenSignature.current === signature) return;
    seenSignature.current = signature;
    if (supported) refreshCatalog();
  }, [signature, supported, refreshCatalog]);
  const canManageConnections = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const writeSettings = useSettingsWriter();
  const configure = useAtomCommand(botEnvironment.configure);
  const [pending, setPending] = useState(false);
  const write = (
    writes: readonly { environmentId: EnvironmentId; patch: ServerSettingsPatch }[],
  ): Promise<void> => {
    if (!environment || pending || writes.length === 0) return Promise.resolve();
    setPending(true);
    return writeSettings(resolveMobileSettingsTargets([environment], null), writes).finally(() =>
      setPending(false),
    );
  };
  return {
    environment: environment ?? null,
    supported,
    callsNote: voiceCallsNote({
      callsSupported: environment?.serverConfig.environment.capabilities.botVoice === true,
    }),
    catalog,
    canManageConnections,
    canWriteSettings,
    pending,
    write,
    configure: async (input: Parameters<typeof configure>[0]["input"]) => {
      if (pending || !canWriteSettings) return;
      setPending(true);
      try {
        const result = await configure({ environmentId, input });
        if (result._tag !== "Success") {
          const failure = squashAtomCommandFailure(result);
          Dialog.alert(
            "Could not save voice",
            failure instanceof Error ? failure.message : "Please try again.",
          );
        }
      } finally {
        setPending(false);
      }
    },
  };
}

function VoiceScreen(props: {
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

/** Explains what the page is for, or why it cannot show anything for this environment. */
function VoiceEnvironmentGate(props: {
  readonly voice: ReturnType<typeof useVoiceEnvironment>;
  readonly children: ReactNode;
}) {
  const { voice } = props;
  if (voice.environment === null) return <Muted>This environment isn't connected.</Muted>;
  if (!voice.supported) return <Muted>Update this environment to set up bot voices.</Muted>;
  if (voice.catalog.data === null) {
    return voice.catalog.error ? (
      <SettingsSection footer={voice.catalog.error}>
        <SettingsActionRow
          icon="arrow.clockwise"
          label="Try again"
          onPress={voice.catalog.refresh}
        />
      </SettingsSection>
    ) : (
      <Muted>Loading voices…</Muted>
    );
  }
  return props.children;
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

export function SettingsVoiceRouteScreen(
  _props: StaticScreenProps<{ readonly environmentId?: EnvironmentId } | undefined>,
) {
  const { availableTargets } = useSettingsEnvironmentFilter();
  const [advanced, setAdvanced] = useState(false);
  const targets = availableTargets;
  return (
    <VoiceScreen title="Voice">
      <Muted>Choose how each bot sounds. Play a sample before choosing.</Muted>
      {targets.length === 0 ? <Muted>Connect to your bots to change their voices.</Muted> : null}
      <SettingsSection title="Bots">
        {targets.map((target) => (
          <VoiceEnvironmentOverview key={target.environmentId} target={target} mode="bots" />
        ))}
      </SettingsSection>
      <SettingsSection>
        <SettingsActionRow
          icon="gearshape"
          label={advanced ? "Hide advanced settings" : "Advanced settings"}
          onPress={() => setAdvanced(!advanced)}
        />
      </SettingsSection>
      {advanced
        ? targets.map((target) => (
            <VoiceEnvironmentOverview key={target.environmentId} target={target} mode="advanced" />
          ))
        : null}
    </VoiceScreen>
  );
}

export function VoiceEnvironmentOverview(props: {
  readonly target: SettingsTarget;
  readonly mode: "bots" | "advanced";
}) {
  const environmentId = props.target.environmentId;
  const navigation = useNavigation();
  const voice = useVoiceEnvironment(environmentId);
  const bots = useEnvironmentBots(environmentId);
  const settings = props.target.serverConfig.settings;
  const catalog = voice.catalog.data;
  if (props.mode === "advanced" && bots.length === 0) return null;
  return (
    <View className="gap-6">
      <VoiceEnvironmentGate voice={voice}>
        {props.mode === "advanced" ? (
          <SettingsSection
            title={`Voice setup · ${bots.map((bot) => bot.title).join(", ")}`}
            footer={voice.callsNote}
          >
            {(catalog?.connections ?? []).map((connection) => (
              <SettingsRow
                key={connection.id}
                icon="headphones"
                label={connection.name}
                value={`${voiceConnectionKindLabel(connection.kind)} · ${voiceConnectionStatusLabel(connection)}`}
                valuePosition="below"
                onPress={() =>
                  navigation.navigate("SettingsSheet", {
                    screen: "SettingsContent",
                    params: {
                      screen: "SettingsVoiceConnection",
                      params: {
                        environmentId,
                        connectionId: connection.id,
                      },
                    },
                  })
                }
              />
            ))}
            <SettingsActionRow
              icon="plus"
              label="Add connection"
              disabled={!voice.canManageConnections}
              onPress={() =>
                navigation.navigate("SettingsSheet", {
                  screen: "SettingsContent",
                  params: { screen: "SettingsVoiceConnection", params: { environmentId } },
                })
              }
            />
          </SettingsSection>
        ) : null}
        {props.mode === "bots" && bots.length > 0 ? (
          <View>
            {bots.map((bot) => {
              const source = botVoiceSource(settings, bot.id);
              return (
                <SettingsRow
                  key={bot.id}
                  icon={bot.botRole === "assistant" ? "sparkles" : "person.crop.circle"}
                  label={bot.title}
                  value={
                    source.kind === "default"
                      ? `Default · ${voiceSelectionLabel(catalog, source.selection)}`
                      : voiceSelectionLabel(catalog, source.selection)
                  }
                  valuePosition="below"
                  onPress={() =>
                    openSettings(navigation, "SettingsVoiceBot", {
                      environmentId,
                      projectId: bot.id,
                    })
                  }
                />
              );
            })}
          </View>
        ) : null}
      </VoiceEnvironmentGate>
    </View>
  );
}

export function BotVoiceSettingsRow({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId?: ProjectId;
}) {
  const voice = useVoiceEnvironment(environmentId);
  const navigation = useNavigation();
  const settings = voice.environment?.serverConfig.settings;
  const source = settings
    ? projectId
      ? botVoiceSource(settings, projectId)
      : { kind: "own", selection: botDefaultVoice(settings) }
    : null;
  return (
    <SettingsRow
      icon="headphones"
      label={projectId ? "Voice" : "Default voice"}
      value={`${source?.kind === "default" ? "Use default · " : ""}${voiceSelectionLabel(voice.catalog.data, source?.selection ?? null)}`}
      valuePosition="below"
      onPress={() =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: projectId
            ? { screen: "SettingsVoiceBot", params: { environmentId, projectId } }
            : { screen: "SettingsVoiceDefault", params: { environmentId } },
        })
      }
    />
  );
}

/** Connection, then model when there is a choice, then voice. Labels come from the catalog only. */
function VoicePicker(props: {
  readonly environmentId: EnvironmentId;
  readonly connections: readonly VoiceCatalogConnection[];
  readonly selection: VoiceSelection | null;
  readonly disabled: boolean;
  readonly onSelect: (selection: VoiceSelection) => void;
}) {
  const preview = useVoicePreview(props.environmentId);
  const connection = props.connections.find((entry) => entry.id === props.selection?.connectionId);
  const model = connection?.models.find((entry) => entry.id === props.selection?.model);
  // A saved pick on an unusable account stays visible, but offers no alternatives on it.
  const locked =
    props.disabled || (connection !== undefined && !isVoiceConnectionUsable(connection));
  return (
    <>
      <SettingsSection title="Connection" footer={connection?.reason ?? undefined}>
        {props.connections.map((entry, index) => {
          const first = firstVoiceSelection(entry);
          return (
            <SettingsChoiceRow
              key={entry.id}
              label={entry.name}
              description={
                entry.reason ??
                (isVoiceConnectionUsable(entry) ? undefined : voiceConnectionStatusLabel(entry))
              }
              selected={entry.id === connection?.id}
              separated={index > 0}
              disabled={props.disabled || first === null}
              onPress={() => {
                if (first && entry.id !== connection?.id) props.onSelect(first);
              }}
            />
          );
        })}
        {props.connections.length === 0 ? (
          <Text className="px-4 py-3 text-sm text-foreground-muted">
            Add a connection on the Voice page first.
          </Text>
        ) : null}
      </SettingsSection>
      {connection && connection.models.length > 1 ? (
        <SettingsSection title="Model">
          {connection.models.map((entry, index) => (
            <SettingsChoiceRow
              key={entry.id}
              label={entry.label}
              selected={entry.id === model?.id}
              separated={index > 0}
              disabled={locked || entry.voices.length === 0}
              onPress={() => {
                const voice = entry.voices[0];
                if (voice && entry.id !== model?.id)
                  props.onSelect({ connectionId: connection.id, model: entry.id, voice: voice.id });
              }}
            />
          ))}
        </SettingsSection>
      ) : null}
      {connection && model ? (
        <SettingsSection title="Voice">
          {preview.error ? (
            <Text className="px-4 py-2 text-danger-foreground">{preview.error}</Text>
          ) : null}
          {model.voices.map((entry, index) => {
            const selection = { connectionId: connection.id, model: model.id, voice: entry.id };
            const playing = preview.playing === JSON.stringify(selection);
            return (
              <View
                key={entry.id}
                className={`flex-row items-center border-border ${entry.id === props.selection?.voice ? "bg-subtle-strong" : ""}`}
                style={{ borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0 }}
              >
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: entry.id === props.selection?.voice,
                    disabled: locked,
                  }}
                  disabled={locked}
                  onPress={() => props.onSelect(selection)}
                  className="min-h-14 flex-1 flex-row items-center gap-3 px-4 py-3"
                >
                  <Text className="flex-1 text-base text-foreground">{entry.label}</Text>
                  {entry.id === props.selection?.voice ? (
                    <SymbolView name="checkmark" size={17} tintColorClassName="accent-primary" />
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${playing ? "Stop" : "Preview"} ${entry.label}`}
                  disabled={!isVoiceConnectionUsable(connection)}
                  onPress={() => void preview.play(selection, connection.kind)}
                  className="size-14 items-center justify-center"
                >
                  <View className="size-8 items-center justify-center rounded-full bg-subtle-strong">
                    <SymbolView
                      name={playing ? "stop.fill" : "play"}
                      size={14}
                      tintColorClassName="accent-foreground"
                    />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </SettingsSection>
      ) : null}
    </>
  );
}

export function SettingsVoiceDefaultRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId }>) {
  const { environmentId } = route.params;
  const voice = useVoiceEnvironment(environmentId);
  const selection = voice.environment
    ? botDefaultVoice(voice.environment.serverConfig.settings)
    : null;
  const disabled = !voice.canWriteSettings || voice.pending;
  const save = (voiceSelection: VoiceSelection | null) =>
    void voice.configure({ defaultVoiceSelection: voiceSelection });
  return (
    <VoiceScreen title="Default voice">
      <VoiceEnvironmentGate voice={voice}>
        <VoicePicker
          environmentId={environmentId}
          connections={voice.catalog.data?.connections ?? []}
          selection={selection}
          disabled={disabled}
          onSelect={save}
        />
        {selection !== null ? (
          <SettingsSection footer="Bots without their own voice will have none.">
            <SettingsActionRow
              icon="xmark"
              label="Clear default"
              tone="danger"
              disabled={disabled}
              onPress={() => save(null)}
            />
          </SettingsSection>
        ) : null}
        {voice.callsNote ? <Muted>{voice.callsNote}</Muted> : null}
      </VoiceEnvironmentGate>
    </VoiceScreen>
  );
}

export function SettingsVoiceBotRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId; readonly projectId: ProjectId }>) {
  const { environmentId, projectId } = route.params;
  const navigation = useNavigation();
  const voice = useVoiceEnvironment(environmentId);
  const bot = useProjects().find(
    (project) => project.environmentId === environmentId && project.id === projectId,
  );
  const environment = voice.environment;
  const role = bot ? botRole(bot) : null;
  const title = bot?.title ?? "Bot";
  if (environment === null || !bot || role === null) {
    return (
      <VoiceScreen title="Voice">
        <Muted>
          {environment === null ? "This environment isn't connected." : "This bot isn't available."}
        </Muted>
      </VoiceScreen>
    );
  }
  const settings = environment.serverConfig.settings;
  const source = botVoiceSource(settings, projectId);
  const supportsOverrides =
    environment.serverConfig.environment.capabilities.projectSettingsOverrides === true;
  const disabled = !voice.canWriteSettings || voice.pending || !supportsOverrides;
  const catalog = voice.catalog.data;
  const choose = (voiceSelection: VoiceSelection | null) =>
    void voice.configure({ voiceOverride: { projectId, selection: voiceSelection } });
  return (
    <VoiceScreen title={title}>
      <SettingsSection>
        <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
          <BotAvatar role={role} title={title} size={32} project={bot} />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text textRole="body" className="font-t3-medium text-foreground" numberOfLines={1}>
              {title}
            </Text>
            <Text textRole="footnote" className="text-foreground-muted">
              Choose a voice and play a sample before saving.
            </Text>
          </View>
        </View>
      </SettingsSection>
      <VoiceEnvironmentGate voice={voice}>
        <SettingsSection
          title="Voice"
          footer={
            !supportsOverrides
              ? "Update this environment to give bots their own voice."
              : source.kind === "default"
                ? "Follows the default. Turn off to choose a voice for this bot."
                : undefined
          }
        >
          <ListToggleRow
            label="Use default voice"
            description={voiceSelectionLabel(catalog, botDefaultVoice(settings))}
            value={source.kind === "default"}
            disabled={disabled}
            onValueChange={(useDefault) => {
              if (useDefault) {
                void voice.configure({ voiceOverride: { projectId, selection: "inherit" } });
              } else {
                // Starts from the default so turning this off changes nothing until a pick.
                choose(botDefaultVoice(settings));
              }
            }}
          />
        </SettingsSection>
        {source.kind === "own" ? (
          <VoicePicker
            environmentId={environmentId}
            connections={catalog?.connections ?? []}
            selection={source.selection}
            disabled={disabled}
            onSelect={choose}
          />
        ) : null}
        <SettingsSection footer={voice.callsNote}>
          <SettingsRow
            icon="headphones"
            label="Voice connections"
            onPress={() => openSettings(navigation, "SettingsBots")}
          />
        </SettingsSection>
      </VoiceEnvironmentGate>
    </VoiceScreen>
  );
}

export function SettingsVoiceConnectionRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId; readonly connectionId?: string }>) {
  const { environmentId, connectionId } = route.params;
  // Key the form to the connection so a reused screen never carries another key's draft.
  return (
    <VoiceConnectionForm
      key={`${environmentId}:${connectionId ?? "new"}`}
      environmentId={environmentId}
      connectionId={connectionId ?? null}
    />
  );
}

function VoiceConnectionForm(props: {
  readonly environmentId: EnvironmentId;
  readonly connectionId: string | null;
}) {
  const { environmentId } = props;
  const navigation = useNavigation();
  const voice = useVoiceEnvironment(environmentId);
  const settings = voice.environment?.serverConfig.settings;
  const sources = settings ? subscriptionVoiceSources(settings) : [];
  const connections = settings?.voiceConnections ?? {};
  const existing = props.connectionId === null ? null : (connections[props.connectionId] ?? null);
  const status = voice.catalog.data?.connections.find((entry) => entry.id === props.connectionId);
  const [kind, setKind] = useState<VoiceConnectionKind>(existing?.kind ?? "openai-api");
  const [name, setName] = useState(existing?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pickedInstanceId, setProviderInstanceId] = useState<ProviderInstanceId | null>(
    existing?.kind === "codex-subscription" ? existing.providerInstanceId : null,
  );
  // Settings can arrive after the form opens, so the first eligible login is derived, not stored.
  const providerInstanceId = pickedInstanceId ?? sources[0]?.id ?? null;
  // One id per opened form, so a retry after a lost response replaces its own entry, and two
  // devices adding at once never overwrite each other's key.
  const [newConnectionId] = useState(uuidv4);
  const connectionId = props.connectionId ?? newConnectionId;
  // Accounts use the raw command: the scoped writer is for voice choices, and these entries
  // need providers:manage rather than settings:write.
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writeConnection = async (value: VoiceConnection | null) => {
    if (saving || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return false;
    setSaving(true);
    setError(null);
    const result = await updateSettings({
      environmentId,
      input: { patch: { voiceConnections: { [connectionId]: value } } },
    });
    setSaving(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not save the connection.");
    }
    return false;
  };
  const disabled = !voice.canManageConnections || saving;
  const next = voiceConnectionPatch({
    kind,
    name,
    apiKeyDraft: apiKey,
    existing,
    providerInstanceId,
  });
  const save = async () => {
    if (next === null) return;
    if (await writeConnection(next)) {
      setApiKey("");
      navigation.goBack();
    }
  };
  const remove = () => {
    if (props.connectionId === null) return;
    Dialog.alert(
      "Remove connection?",
      "Its saved key is deleted from this environment. Bots using it will need another voice.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void writeConnection(null).then((saved) => {
              if (saved) navigation.goBack();
            });
          },
        },
      ],
    );
  };
  if (props.connectionId !== null && existing === null && voice.environment !== null) {
    return (
      <VoiceScreen title="Connection">
        <Muted>This connection was removed.</Muted>
      </VoiceScreen>
    );
  }
  const hasSavedKey = existing !== null && "apiKey" in existing && existing.apiKey !== "";
  return (
    <VoiceScreen title={existing ? existing.name : "Add connection"}>
      <VoiceEnvironmentGate voice={voice}>
        {status ? (
          <SettingsSection
            title="Status"
            footer={
              status.reason ??
              voiceCallsNote({
                callsSupported:
                  voice.environment?.serverConfig.environment.capabilities.botVoice === true,
                kind: status.kind,
              })
            }
          >
            <View className="px-4 py-3">
              <Text className="text-base text-foreground">
                {voiceConnectionStatusLabel(status)}
              </Text>
            </View>
          </SettingsSection>
        ) : null}
        {existing === null ? (
          <SettingsSection title="Type">
            {VOICE_CONNECTION_KINDS.map((entry, index) => (
              <SettingsChoiceRow
                key={entry.kind}
                label={entry.label}
                description={entry.description}
                selected={kind === entry.kind}
                separated={index > 0}
                disabled={disabled}
                onPress={() => setKind(entry.kind)}
              />
            ))}
          </SettingsSection>
        ) : null}
        <SettingsSection title="Name">
          <View className="px-4 py-2">
            <AppTextInput
              accessibilityLabel="Connection name"
              value={name}
              onChangeText={setName}
              placeholder={voiceConnectionKindLabel(kind)}
              editable={!disabled}
              maxLength={100}
              className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
            />
          </View>
        </SettingsSection>
        {kind === "codex-subscription" ? (
          <SettingsSection
            title="ChatGPT account"
            footer="Existing Codex CLI logins signed in with ChatGPT. Accounts added with Connect with ChatGPT can't provide voice."
          >
            {sources.map((source, index) => (
              <SettingsChoiceRow
                key={source.id}
                label={source.label}
                selected={providerInstanceId === source.id}
                separated={index > 0}
                disabled={disabled}
                onPress={() => setProviderInstanceId(source.id)}
              />
            ))}
            {sources.length === 0 ? (
              <Text className="px-4 py-3 text-sm text-foreground-muted">
                Enable an existing Codex login in Providers first.
              </Text>
            ) : null}
          </SettingsSection>
        ) : (
          <SettingsSection
            title="API key"
            footer="Stored on this environment, not on this device. Saving doesn't test the key."
          >
            <View className="px-4 py-2">
              <AppTextInput
                accessibilityLabel={`${voiceConnectionKindLabel(kind)}`}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={hasSavedKey ? "Saved. Paste a new key to replace it." : "Paste a key"}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
              />
            </View>
          </SettingsSection>
        )}
        <SettingsSection
          footer={
            error ??
            (voice.canManageConnections ? undefined : "This device can't manage providers here.")
          }
        >
          <SettingsActionRow
            icon="checkmark"
            label={existing ? "Save" : "Add connection"}
            disabled={disabled || next === null}
            loading={saving}
            onPress={() => void save()}
          />
          {existing ? (
            <SettingsActionRow
              icon="trash"
              label="Remove connection"
              tone="danger"
              disabled={disabled}
              onPress={remove}
            />
          ) : null}
        </SettingsSection>
      </VoiceEnvironmentGate>
    </VoiceScreen>
  );
}
