import { BotSettingMode } from "./BotSettingMode";
import { botDefaultVoice } from "@t3tools/shared/botPreferences";
import { botEnvironment } from "../../state/bots";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useBotProjects } from "../bots/useBotRoom";
import { useEnvironments } from "../../state/environments";
import { SettingsScopeProvider } from "./SettingsScopeContext";
import { voiceProviderInstances } from "@t3tools/shared/voiceProviderInstances";
import {
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
  type ServerSettings,
  type ServerSettingsPatch,
  type VoiceCatalog,
  type VoiceConnection,
  resolveProviderInstanceEnabled,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useVoiceCatalog } from "../../state/botVoice";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { VoiceSelectionPicker } from "../bots/VoiceSelectionPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { readCodexSetupMode } from "./CodexSetupSection.logic";
import { SecretInput } from "./SecretInput";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  describeVoiceSelection,
  resolveBotVoice,
  VOICE_CONNECTION_KIND_LABELS,
  voiceConnectionStatus,
  voiceConnectionUsers,
  type VoiceConnectionKind,
  type VoiceSelectionDescription,
} from "./voiceSettings.logic";

export function botVoiceSettingsTargetId(projectId: ProjectId) {
  return `voice-bot-${projectId}` as const;
}

interface VoiceEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

function VoiceStatus({ description }: { description: VoiceSelectionDescription }) {
  if (description.detail === null) return null;
  return description.issue ? (
    <span className="text-warning-foreground">{description.detail}</span>
  ) : (
    description.detail
  );
}

export function VoiceSetupSettings() {
  const { environments } = useEnvironments();
  const projects = useBotProjects();
  return (
    <>
      {environments
        .filter(
          (entry) => entry.serverConfig?.environment.capabilities.botVoiceConfiguration === true,
        )
        .map((environment) => (
          <SettingsScopeProvider
            key={environment.environmentId}
            search={{ machine: environment.environmentId }}
            onChange={() => {}}
            singleEnvironment
          >
            <VoiceSetup
              environment={environment}
              settings={environment.serverConfig!.settings}
              projects={projects}
            />
          </SettingsScopeProvider>
        ))}
    </>
  );
}

function VoiceSetup({
  environment,
  settings,
  projects,
}: {
  environment: VoiceEnvironment;
  settings: ServerSettings;
  projects: ReadonlyArray<EnvironmentProject>;
}) {
  const { catalog, error } = useVoiceCatalog(environment.environmentId, settings.voiceConnections);
  const bots = projects.filter(
    (bot) => bot.environmentId === environment.environmentId && bot.botRole != null,
  );
  if (bots.length === 0) return null;
  return (
    <VoiceAccountsSection
      environment={environment}
      settings={settings}
      catalog={catalog}
      catalogError={error}
      bots={bots}
    />
  );
}

export function BotVoiceSetting({
  bot,
  environmentId,
}: {
  bot?: EnvironmentProject;
  environmentId: EnvironmentId;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const { catalog } = useVoiceCatalog(environmentId, settings.voiceConnections);
  const configure = useAtomCommand(botEnvironment.configure);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const voice = bot
    ? resolveBotVoice(settings, bot.id)
    : { kind: "own", selection: botDefaultVoice(settings) };
  const own = voice.kind === "own";
  const defaultLabel = describeVoiceSelection(botDefaultVoice(settings), catalog).label;
  const picker = (
    <VoiceSelectionPicker
      environmentId={environmentId}
      catalog={catalog}
      selection={voice.selection}
      {...(bot ? { inherit: { label: `Use default · ${defaultLabel}`, active: !own } } : {})}
      ariaLabel={bot ? `${bot.title} voice` : "Default bot voice"}
      className="w-full sm:w-56"
      disabled={!canWrite}
      onChange={(change) =>
        void configure({
          environmentId,
          input: bot
            ? {
                voiceOverride: {
                  projectId: bot.id,
                  selection: change.kind === "inherit" ? "inherit" : change.selection,
                },
              }
            : change.kind === "set"
              ? { defaultVoiceSelection: change.selection }
              : {},
        })
      }
    />
  );
  return (
    <SettingsRow
      id={bot ? botVoiceSettingsTargetId(bot.id) : "voice-default"}
      title={bot ? "Voice" : "Default voice"}
      description={bot ? undefined : "Every bot uses this voice unless you choose an override."}
      status={<VoiceStatus description={describeVoiceSelection(voice.selection, catalog)} />}
      control={
        bot ? (
          <BotSettingMode
            label={`${bot.title} voice`}
            custom={own}
            disabled={!canWrite}
            onDefault={() =>
              void configure({
                environmentId,
                input: { voiceOverride: { projectId: bot.id, selection: "inherit" } },
              })
            }
            onCustom={() => {
              if (!own)
                void configure({
                  environmentId,
                  input: { voiceOverride: { projectId: bot.id, selection: voice.selection } },
                });
            }}
          >
            {picker}
          </BotSettingMode>
        ) : (
          picker
        )
      }
    />
  );
}

const DEFAULT_ACCOUNT_NAMES: Readonly<Record<VoiceConnectionKind, string>> = {
  "openai-api": "OpenAI API",
  "xai-api": "xAI API",
  "codex-subscription": "ChatGPT",
};

// Mirrors the server's subscription voice eligibility: an enabled Codex instance using its own
// CLI login. Connect with ChatGPT sharing accounts can't open subscription voice.
function codexInstances(settings: ServerSettings) {
  return Object.entries(voiceProviderInstances(settings)).flatMap(([id, instance]) =>
    instance.driver === "codex" &&
    resolveProviderInstanceEnabled(instance) &&
    readCodexSetupMode(instance.config) === "existing"
      ? [{ id: id as ProviderInstanceId, label: instance.displayName ?? id }]
      : [],
  );
}

function accountDescription(connection: VoiceConnection, settings: ServerSettings): string {
  switch (connection.kind) {
    case "openai-api":
      return "OpenAI API key. Usage is billed by OpenAI.";
    case "xai-api":
      return "xAI API key. Usage is billed by xAI; your Grok sign-in isn't used.";
    case "codex-subscription":
      return `Uses the ChatGPT sign-in from ${
        settings.providerInstances[connection.providerInstanceId]?.displayName ??
        connection.providerInstanceId
      }.`;
  }
}

type AccountEditor =
  | { readonly mode: "add"; readonly kind: VoiceConnectionKind }
  | { readonly mode: "edit"; readonly id: string };

function VoiceAccountsSection({
  environment,
  settings,
  catalog,
  catalogError,
  bots,
}: {
  environment: VoiceEnvironment;
  settings: ServerSettings;
  catalog: VoiceCatalog | null;
  catalogError: string | null;
  bots: ReadonlyArray<EnvironmentProject>;
}) {
  const canManage = useEnvironmentScope(environment.environmentId, AuthProvidersManageScope);
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const entries = Object.entries(settings.voiceConnections);
  const subscriptionSources = codexInstances(settings);
  const close = () => setEditor(null);
  return (
    <SettingsSection
      id="voice-accounts"
      title="Voice accounts"
      headerAction={
        canManage ? (
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>
              <PlusIcon />
              Add account
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setEditor({ mode: "add", kind: "openai-api" })}>
                OpenAI API key
              </MenuItem>
              <MenuItem onClick={() => setEditor({ mode: "add", kind: "xai-api" })}>
                xAI API key
              </MenuItem>
              <MenuItem
                disabled={subscriptionSources.length === 0}
                onClick={() => setEditor({ mode: "add", kind: "codex-subscription" })}
              >
                {subscriptionSources.length === 0
                  ? "ChatGPT subscription (enable an existing Codex login in Providers)"
                  : "ChatGPT subscription"}
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      {entries.length === 0 && editor?.mode !== "add" ? (
        <SettingsRow
          title="No voice accounts"
          description={`Add an API key or ChatGPT subscription so bots can talk on calls. Keys are stored on ${environment.label}, not in this browser.`}
        />
      ) : null}
      {entries.map(([id, connection]) => {
        const described = catalog?.connections.find((candidate) => candidate.id === id);
        const status = voiceConnectionStatus(described);
        const editing = editor?.mode === "edit" && editor.id === id;
        return (
          <SettingsRow
            key={id}
            title={connection.name}
            description={accountDescription(connection, settings)}
            status={
              described?.reason ? (
                <span className="text-warning-foreground">{described.reason}</span>
              ) : null
            }
            control={
              <>
                <Badge size="sm" variant={status.variant}>
                  {status.label}
                </Badge>
                {canManage && !editing ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEditor({ mode: "edit", id })}
                  >
                    Edit
                  </Button>
                ) : null}
              </>
            }
          >
            {editing ? (
              <VoiceAccountForm
                environment={environment}
                settings={settings}
                bots={bots}
                id={id}
                kind={connection.kind}
                existing={connection}
                subscriptionSources={subscriptionSources}
                onDone={close}
              />
            ) : null}
          </SettingsRow>
        );
      })}
      {editor?.mode === "add" ? (
        <SettingsRow
          title={`Add ${VOICE_CONNECTION_KIND_LABELS[editor.kind]}`}
          description={
            editor.kind === "codex-subscription"
              ? "Uses an existing Codex CLI login signed in with ChatGPT, where the plan allows voice. Accounts added with Connect with ChatGPT can't provide voice."
              : `Stored on ${environment.label}, not in this browser.`
          }
        >
          <VoiceAccountForm
            environment={environment}
            settings={settings}
            bots={bots}
            id={null}
            kind={editor.kind}
            existing={undefined}
            subscriptionSources={subscriptionSources}
            onDone={close}
          />
        </SettingsRow>
      ) : null}
      {catalogError ? (
        <SettingsRow title="Couldn't check voice accounts" description={catalogError} />
      ) : null}
      {!canManage ? (
        <SettingsRow
          title="Read only"
          description={`This connection can't change voice accounts on ${environment.label}.`}
        />
      ) : null}
    </SettingsSection>
  );
}

function VoiceAccountForm({
  environment,
  settings,
  bots,
  id,
  kind,
  existing,
  subscriptionSources,
  onDone,
}: {
  environment: VoiceEnvironment;
  settings: ServerSettings;
  bots: ReadonlyArray<EnvironmentProject>;
  id: string | null;
  kind: VoiceConnectionKind;
  existing: VoiceConnection | undefined;
  subscriptionSources: ReadonlyArray<{ readonly id: ProviderInstanceId; readonly label: string }>;
  onDone: () => void;
}) {
  // Account edits go straight to the server: the shared settings writer would
  // read a replaced key's redacted echo as a dropped write.
  const update = useAtomCommand(serverEnvironment.updateSettings, { label: "save voice account" });
  const [name, setName] = useState(existing?.name ?? DEFAULT_ACCOUNT_NAMES[kind]);
  const [apiKey, setApiKey] = useState("");
  const [sourceId, setSourceId] = useState<ProviderInstanceId | null>(
    existing?.kind === "codex-subscription"
      ? existing.providerInstanceId
      : (subscriptionSources[0]?.id ?? null),
  );
  const [saving, setSaving] = useState(false);
  // Minted once per form so a retry after a lost response updates the same account.
  const [accountId] = useState(() => id ?? `voice_${randomUUID()}`);
  const savedKey =
    existing !== undefined && existing.kind !== "codex-subscription" ? existing.apiKey : "";
  const trimmedName = name.trim();
  const fieldId = `voice-account-${accountId}`;
  const connection: VoiceConnection | null =
    trimmedName.length === 0
      ? null
      : kind === "codex-subscription"
        ? sourceId === null
          ? null
          : { kind, name: trimmedName, providerInstanceId: sourceId }
        : // A new account needs a key; an existing one keeps its saved key by echoing the marker back.
          apiKey.trim().length === 0 && savedKey.length === 0
          ? null
          : { kind, name: trimmedName, apiKey: apiKey.trim() || savedKey };

  const persist = async (patch: NonNullable<ServerSettingsPatch["voiceConnections"]>) => {
    if (!readEnvironmentScope(environment.environmentId, AuthProvidersManageScope)) return;
    setSaving(true);
    const result = await update({
      environmentId: environment.environmentId,
      input: { patch: { voiceConnections: patch } },
    });
    setSaving(false);
    if (result._tag === "Success") onDone();
  };

  const remove = async () => {
    if (id === null || existing === undefined) return;
    const users = voiceConnectionUsers(settings, id, bots);
    const affected = [...(users.usedByDefault ? ["the default voice"] : []), ...users.botTitles];
    const confirmed = await readLocalApi()?.dialogs.confirm(
      affected.length === 0
        ? `Remove ${existing.name}?`
        : `Remove ${existing.name}? ${affected.join(", ")} will have no voice until you choose another.`,
      { variant: "destructive" },
    );
    if (confirmed) await persist({ [id]: null });
  };

  return (
    <form
      className="grid gap-3 pt-1 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (connection !== null) void persist({ [accountId]: connection });
      }}
    >
      {/* Locked while saving so a successful save never discards edits made mid-request. */}
      <fieldset disabled={saving} className="contents">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor={`${fieldId}-name`}>Name</Label>
            <Input
              id={`${fieldId}-name`}
              size="sm"
              autoComplete="off"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {kind === "codex-subscription" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-source`}>ChatGPT account</Label>
              <Select
                value={sourceId}
                onValueChange={(value) => setSourceId(value as ProviderInstanceId)}
              >
                <SelectTrigger id={`${fieldId}-source`} size="sm">
                  <SelectValue>
                    {(value: ProviderInstanceId | null) =>
                      subscriptionSources.find((source) => source.id === value)?.label ??
                      value ??
                      "Choose an account"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {subscriptionSources.map((source) => (
                    <SelectItem key={source.id} hideIndicator value={source.id}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-key`}>API key</Label>
              <SecretInput
                id={`${fieldId}-key`}
                size="sm"
                configured={savedKey.length > 0}
                placeholder={kind === "xai-api" ? "xai-…" : "sk-…"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            {id !== null ? (
              <Button
                type="button"
                size="xs"
                variant="destructive-outline"
                onClick={() => void remove()}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="xs" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={connection === null}>
              Save
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
