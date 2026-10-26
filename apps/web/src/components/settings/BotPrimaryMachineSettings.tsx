import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import {
  EMPTY_BOT_SHARED_PREFERENCES,
  type ProjectId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { latestBotPreferences } from "@t3tools/client-runtime/assistant-environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { botEnvironment } from "../../state/bots";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const cannotWrite = Atom.make(false);

export function BotPrimaryMachineSettings({
  bot,
}: {
  bot?: { readonly id: ProjectId; readonly title: string };
}) {
  const { environments } = useEnvironments();
  const save = useAtomCommand(botEnvironment.configure);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const choices = eligible.map((entry) => ({
    value: `machine:${entry.environmentId}`,
    environmentId: entry.environmentId,
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
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not save the primary machine.");
    }
  };
  const picker = (
    value: EnvironmentId | null,
    label: string,
    bot?: { readonly id: ProjectId; readonly title: string },
  ) => {
    const items = [...(bot ? [{ value: "default", label: "Use default" }] : []), ...choices];
    if (value && !choices.some((item) => item.environmentId === value))
      items.push({ value: `machine:${value}`, label: "Unavailable machine" });
    return (
      <Select
        items={items}
        value={value === null ? (bot ? "default" : null) : `machine:${value}`}
        disabled={pending || !canWrite}
        onValueChange={(next) => {
          const machine = choices.find((item) => item.value === next);
          if (next === "default" || machine) void change(machine?.environmentId ?? null, bot);
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue placeholder="Choose a primary machine" />
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
  };
  if (bot)
    return (
      <SettingsRow
        title="Primary machine"
        control={picker(preferences.overrides[bot.id] ?? null, `${bot.title} primary machine`, bot)}
        status={error ? <p role="alert">{error}</p> : null}
      />
    );
  return (
    <SettingsSection id="bot-primary-machine" title="Primary machine">
      {error ? <p role="alert">{error}</p> : null}
      <SettingsRow
        id="bot-shared-primary"
        title="Default for all bots"
        description="A synced copy can answer new messages when your primary machine is unavailable. Large files stay where they were uploaded."
        control={picker(preferences.primaryEnvironmentId, "Primary machine")}
      />
    </SettingsSection>
  );
}
