import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";
import {
  EMPTY_BOT_SHARED_PREFERENCES,
  type ProjectId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { latestBotPreferences } from "@t3tools/client-runtime/assistant-environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText } from "../../components/ui/AppText";
import { botEnvironment } from "../../state/bots";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";

const cannotWrite = Atom.make(false);

export function BotPrimaryMachineSettings() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const save = useAtomCommand(botEnvironment.configure);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const eligible = environments.filter(
    (entry) => entry.serverConfig?.environment.capabilities.botReplication === true,
  );
  const writer = eligible.find((entry) => entry.connection.phase === "connected");
  const canWrite = useAtomValue(
    writer ? botEnvironment.configure.permissionAtom(writer.environmentId) : cannotWrite,
  );
  const preferences =
    latestBotPreferences(
      eligible.map((entry) => entry.serverConfig!.settings.botSharedPreferences),
    ) ?? EMPTY_BOT_SHARED_PREFERENCES;
  const unique = [
    ...new Map(
      [...projects]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .filter((project) => project.botRole != null)
        .map((project) => [project.id, project]),
    ).values(),
  ];
  const assistant = unique.find((project) => project.botRole === "assistant");
  const bots = unique.filter(
    (project) => project.botRole !== "assistant" || project.id === assistant?.id,
  );
  const choices = eligible.map((entry) => ({
    value: entry.environmentId,
    label: entry.label,
  }));
  const change = async (
    value: EnvironmentId | null,
    bot?: { readonly id: ProjectId; readonly title: string },
  ) => {
    if (!writer || !canWrite || pending) return;
    setPending(true);
    setError(null);
    const result = await save({
      environmentId: writer.environmentId,
      input: bot
        ? { override: { projectId: bot.id, environmentId: value } }
        : { primaryEnvironmentId: value },
    }).finally(() => setPending(false));
    if (result._tag === "Success") setEditing(null);
    else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not save the primary machine.");
    }
  };
  const row = (
    value: EnvironmentId | null,
    bot?: { readonly id: ProjectId; readonly title: string },
  ) => {
    const key = bot ? `bot:${bot.id}` : "global";
    const label = bot?.title ?? "Default for all bots";
    const fallback = bot ? "Use default" : "Automatic";
    return (
      <View key={key}>
        <SettingsRow
          icon="server.rack"
          label={label}
          value={
            value === null
              ? fallback
              : (choices.find((choice) => choice.value === value)?.label ?? "Unavailable machine")
          }
          disabled={pending || !canWrite}
          onPress={() => setEditing(editing === key ? null : key)}
        />
        {editing === key
          ? [{ value: null, label: fallback }, ...choices].map((choice) => (
              <SettingsChoiceRow
                key={choice.value ?? "default"}
                label={choice.label}
                selected={value === choice.value}
                disabled={pending || !canWrite}
                onPress={() => void change(choice.value, bot)}
              />
            ))
          : null}
      </View>
    );
  };
  return (
    <SettingsSection
      title="Primary machine"
      footer="Your preferred machine. A synced copy can answer new messages when this machine is unavailable. Existing large files stay where they were uploaded."
    >
      {row(preferences.primaryEnvironmentId)}
      {error ? <AppText className="px-4 py-2 text-danger-foreground">{error}</AppText> : null}
      {bots.map((bot) => row(preferences.overrides[bot.id] ?? null, bot))}
    </SettingsSection>
  );
}
