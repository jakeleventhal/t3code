import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProjectSettingsOverrides,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ModelOption } from "../../lib/modelOptions";
import {
  botChatTurn,
  botHostCandidates,
  botHostChoices,
  botModelLabel,
  botRuntimeModeLabel,
  botTurnSettingLabel,
  botTurnSettings,
} from "./bot-turn-settings";

const botId = ProjectId.make("bot");
const sonnet = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "sonnet" };
const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt" };

function settings(input: {
  defaults?: Partial<ServerSettings["botDefaults"]>;
  bot?: ProjectSettingsOverrides;
}): Pick<ServerSettings, "botDefaults" | "projectSettingsOverrides"> {
  return {
    botDefaults: { defaultModelSelection: null, defaultRuntimeMode: null, ...input.defaults },
    projectSettingsOverrides: input.bot ? { [botId]: input.bot } : {},
  };
}

describe("botTurnSettings", () => {
  it("lets a bot's own choice stand over the bot defaults it would otherwise follow", () => {
    const resolved = botTurnSettings(
      settings({
        defaults: { defaultModelSelection: codex, defaultRuntimeMode: "approval-required" },
        bot: { defaultModelSelection: sonnet },
      }),
      botId,
    );
    expect(resolved.model).toEqual({ own: sonnet, inherited: codex });
    expect(resolved.runtimeMode).toEqual({ own: null, inherited: "approval-required" });
  });

  it("treats the bot defaults as the value chosen when there is no bot", () => {
    const resolved = botTurnSettings(
      settings({ defaults: { defaultRuntimeMode: "full-access" } }),
      null,
    );
    expect(resolved.model).toEqual({ own: null, inherited: null });
    expect(resolved.runtimeMode).toEqual({ own: "full-access", inherited: null });
  });
});

describe("botTurnSettingLabel", () => {
  const label = (value: string) => value.toUpperCase();

  it("marks a followed value as the default for a bot, and as automatic for the defaults", () => {
    expect(botTurnSettingLabel({ own: null, inherited: "x" }, label, true)).toBe("Default · X");
    expect(botTurnSettingLabel({ own: null, inherited: null }, label, true)).toBe(
      "Default · Each chat’s own",
    );
    expect(botTurnSettingLabel({ own: null, inherited: null }, label, false)).toBe(
      "Automatic · Each chat’s own",
    );
    expect(botTurnSettingLabel({ own: "y", inherited: "x" }, label, true)).toBe("Y");
  });
});

describe("labels", () => {
  it("names a listed model with its provider, and a missing one by its slug", () => {
    const options = [
      { label: "Sonnet", providerLabel: "Claude", selection: sonnet } as ModelOption,
    ];
    expect(botModelLabel(options, sonnet)).toBe("Sonnet · Claude");
    expect(botModelLabel(options, codex)).toBe("gpt");
  });

  it("uses the permission names the thread settings use", () => {
    expect(botRuntimeModeLabel("approval-required")).toBe("Supervised");
  });
});

describe("botChatTurn", () => {
  const fallback = { modelSelection: codex, runtimeMode: "full-access" as const };
  const bot = { id: botId, botRole: "specialist" as const };
  const claude: ServerProvider = {
    instanceId: sonnet.instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-24T12:00:00.000Z",
    models: [{ slug: "sonnet", name: "Sonnet", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  };
  const config = (overrides: Parameters<typeof settings>[0], providers = [claude]) => ({
    settings: { ...DEFAULT_SERVER_SETTINGS, ...settings(overrides) },
    providers,
  });

  it("leaves a chat on its own settings outside a bot or while nothing is chosen", () => {
    const chosen = config({ bot: { defaultModelSelection: sonnet } });
    expect(botChatTurn({ config: chosen, project: { id: botId, botRole: null }, fallback })).toBe(
      null,
    );
    expect(botChatTurn({ config: config({}), project: bot, fallback })).toBe(null);
    expect(botChatTurn({ config: null, project: bot, fallback })).toBe(null);
  });

  it("sends the bot's chosen model with the permissions it follows", () => {
    expect(
      botChatTurn({
        config: config({
          defaults: { defaultRuntimeMode: "approval-required" },
          bot: { defaultModelSelection: sonnet },
        }),
        project: bot,
        fallback,
      }),
    ).toMatchObject({
      kind: "ready",
      modelSelection: sonnet,
      runtimeMode: "approval-required",
      source: "bot",
    });
  });

  it("reports a chosen model that can't run instead of falling back to the chat's", () => {
    const turn = botChatTurn({
      config: config({ defaults: { defaultModelSelection: sonnet } }, []),
      project: bot,
      fallback,
    });
    expect(turn).toMatchObject({
      kind: "setup-needed",
      modelSelection: sonnet,
      source: "defaults",
    });
  });
});

describe("botHostChoices", () => {
  const home = EnvironmentId.make("home");
  const laptop = EnvironmentId.make("laptop");
  const old = EnvironmentId.make("old");
  const candidates = botHostCandidates([
    {
      environmentId: home,
      environmentLabel: "Home",
      isEnabled: true,
      connectionState: "connected",
      supportsBots: true,
    },
    {
      environmentId: laptop,
      environmentLabel: "Laptop",
      isEnabled: false,
      connectionState: "connected",
      supportsBots: true,
    },
    {
      environmentId: old,
      environmentLabel: "Old",
      isEnabled: true,
      connectionState: "connected",
      supportsBots: false,
    },
  ]);

  it("offers the environment itself first, then the others with why they can't host", () => {
    expect(
      botHostChoices({ environmentId: home, label: "Home", stored: null, candidates }),
    ).toEqual([
      { value: null, label: "This environment (Home)", status: null, selected: true },
      { value: laptop, label: "Laptop", status: "Offline", selected: false },
      { value: old, label: "Old", status: "Needs a newer T3 Code server", selected: false },
    ]);
  });

  it("treats a host saved as the environment's own id as the environment itself", () => {
    const choices = botHostChoices({
      environmentId: home,
      label: "Home",
      stored: home,
      candidates,
    });
    expect(choices.filter((choice) => choice.selected).map((choice) => choice.value)).toEqual([
      null,
    ]);
  });

  it("keeps a saved host this device doesn't know selected", () => {
    const stranger = EnvironmentId.make("stranger");
    const choices = botHostChoices({
      environmentId: home,
      label: "Home",
      stored: stranger,
      candidates,
    });
    expect(choices.filter((choice) => choice.selected)).toEqual([
      { value: stranger, label: "Not connected to this device", status: null, selected: true },
    ]);
  });
});
