import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { botComplexTaskModel } from "@t3tools/shared/botPreferences";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import {
  BotModelPicker,
  useEnvironmentBotProviders,
  newThreadFallback,
} from "../bots/BotRuntimeSettings";
import { BotSettingMode } from "./BotSettingMode";
import { SettingsRow } from "./settingsLayout";

export function BotComplexModelSetting({
  environmentId,
  projectId = null,
}: {
  environmentId: EnvironmentId;
  projectId?: ProjectId | null;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const preferences = settings.botSharedPreferences;
  const providers = useEnvironmentBotProviders(environmentId);
  const save = useAtomCommand(botEnvironment.configure);
  const canWrite = useAtomValue(botEnvironment.configure.permissionAtom(environmentId));
  const selection = botComplexTaskModel(preferences, projectId);
  const shown =
    selection ??
    settings.botDefaults.defaultModelSelection ??
    newThreadFallback(settings, providers)?.modelSelection;
  const own = projectId
    ? preferences.complexTaskModelOverrides?.[projectId]
    : preferences.complexTaskModelSelection;
  const change = (selection: typeof shown | null) =>
    void save({
      environmentId,
      input: projectId
        ? { complexTaskModelOverride: { projectId, selection: selection ?? null } }
        : { complexTaskModelSelection: selection ?? null },
    });
  const picker = shown ? (
    <BotModelPicker
      environmentId={environmentId}
      projectId={projectId}
      settings={settings}
      providers={providers}
      selection={shown}
      {...(!selection ? { placeholder: projectId ? "Use default" : "Choose a model" } : {})}
      disabled={!canWrite}
      onChange={change}
    />
  ) : (
    <span>No providers available</span>
  );
  return (
    <SettingsRow
      title="Complex-task model"
      description="Handles difficult work while chat stays available."
      control={
        projectId ? (
          <BotSettingMode
            label="Complex-task model"
            custom={own != null}
            disabled={!canWrite || !shown}
            onDefault={() => change(null)}
            onCustom={() => {
              if (!own && shown) change(shown);
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
