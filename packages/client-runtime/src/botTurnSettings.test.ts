import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettings,
  type ServerProvider,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  botDefaultsPatch,
  planSharedBotDefaults,
  botTurnOverridePatch,
  resolveBotTurnReadiness,
  resolveNewBotHost,
  supportsBotRuntimeSettings,
} from "./botTurnSettings.ts";

const bot = ProjectId.make("fitness");
const fallback = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-old" },
  runtimeMode: "full-access" as const,
};
const claude = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
  options: [{ id: "effort", value: "high" }],
};

function provider(
  instanceId: string,
  models: ReadonlyArray<string>,
  overrides: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(instanceId),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-24T12:00:00.000Z",
    models: models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const providers = [provider("codex", ["gpt-old"]), provider("claudeAgent", ["claude-opus-5-5"])];
const withDefaults = applyServerSettingsPatch(
  DEFAULT_SERVER_SETTINGS,
  botDefaultsPatch(DEFAULT_SERVER_SETTINGS, { defaultModelSelection: claude }),
);

describe("resolveBotTurnReadiness", () => {
  it("keeps the existing fallback untouched while nothing is configured", () => {
    expect(
      resolveBotTurnReadiness({
        settings: DEFAULT_SERVER_SETTINGS,
        projectId: bot,
        fallback,
        providers: [],
      }),
    ).toEqual({ kind: "ready", ...fallback, source: "inherited" });
  });

  it("uses the bot defaults, options included, for existing and new bots", () => {
    for (const projectId of [bot, null]) {
      expect(
        resolveBotTurnReadiness({ settings: withDefaults, projectId, fallback, providers }),
      ).toEqual({
        kind: "ready",
        modelSelection: claude,
        runtimeMode: "full-access",
        source: "defaults",
      });
    }
  });

  it("reports setup instead of substituting a model whose provider is gone or disabled", () => {
    for (const available of [
      [provider("codex", ["gpt-old"])],
      [provider("codex", ["gpt-old"]), provider("claudeAgent", [], { enabled: false })],
      [
        provider("codex", ["gpt-old"]),
        provider("claudeAgent", [], { availability: "unavailable" }),
      ],
    ]) {
      const readiness = resolveBotTurnReadiness({
        settings: withDefaults,
        projectId: bot,
        fallback,
        providers: available,
      });
      expect(readiness).toMatchObject({
        kind: "setup-needed",
        modelSelection: claude,
        instanceId: claude.instanceId,
      });
    }
  });

  it("reports a model its provider no longer offers", () => {
    const readiness = resolveBotTurnReadiness({
      settings: withDefaults,
      projectId: bot,
      fallback,
      providers: [provider("claudeAgent", ["claude-sonnet-5-5"])],
    });
    expect(readiness.kind).toBe("setup-needed");
    expect(readiness.kind === "setup-needed" ? readiness.reason : null).toContain(
      "claude-opus-5-5",
    );
  });

  it("accepts a custom model configured on the provider instance", () => {
    const custom = applyServerSettingsPatch(withDefaults, {
      providerInstances: {
        [claude.instanceId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          config: { customModels: ["claude-opus-5-5"] },
        },
      },
    });
    expect(
      resolveBotTurnReadiness({
        settings: custom,
        projectId: bot,
        fallback,
        providers: [provider("claudeAgent", ["claude-sonnet-5-5"])],
      }).kind,
    ).toBe("ready");
  });

  it("lets a bot's own override win and be cleared back to the defaults", () => {
    const own = applyServerSettingsPatch(
      withDefaults,
      botTurnOverridePatch(withDefaults, bot, {
        modelSelection: fallback.modelSelection,
        runtimeMode: "approval-required",
      }),
    );
    expect(resolveBotTurnReadiness({ settings: own, projectId: bot, fallback, providers })).toEqual(
      {
        kind: "ready",
        modelSelection: fallback.modelSelection,
        runtimeMode: "approval-required",
        source: "bot",
      },
    );
    const reset = applyServerSettingsPatch(
      own,
      botTurnOverridePatch(own, bot, { modelSelection: null }),
    );
    expect(
      resolveBotTurnReadiness({ settings: reset, projectId: bot, fallback, providers }),
    ).toEqual({
      kind: "ready",
      modelSelection: claude,
      runtimeMode: "approval-required",
      source: "defaults",
    });
  });
});

describe("botTurnOverridePatch", () => {
  it("keeps unrelated overrides and drops the entry once it is empty", () => {
    const voice = { connectionId: "openai", model: "gpt-realtime", voice: "marin" };
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectSettingsOverrides: {
        [bot]: { voiceSelection: voice, defaultModelSelection: claude },
      },
    });
    expect(botTurnOverridePatch(settings, bot, { modelSelection: null })).toEqual({
      projectSettingsOverrides: { [bot]: { voiceSelection: voice } },
    });
    const onlyModel = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectSettingsOverrides: { [bot]: { defaultModelSelection: claude } },
    });
    expect(botTurnOverridePatch(onlyModel, bot, { modelSelection: null })).toEqual({
      projectSettingsOverrides: { [bot]: null },
    });
  });
});

const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

describe("supportsBotRuntimeSettings", () => {
  it("keeps bot settings read-only on servers that would drop them", () => {
    expect(supportsBotRuntimeSettings(decodeCapabilities({ botConversations: true }))).toBe(false);
    expect(supportsBotRuntimeSettings(null)).toBe(false);
    expect(
      supportsBotRuntimeSettings(
        decodeCapabilities({ botConversations: true, botRuntimeSettings: true }),
      ),
    ).toBe(true);
  });

  it("reads settings from an older server as having no bot defaults or default host", () => {
    const settings = decodeServerSettings({});
    expect(settings.defaultBotEnvironmentId).toBeNull();
    expect(settings.botDefaults).toEqual({ defaultModelSelection: null, defaultRuntimeMode: null });
  });
});

describe("resolveNewBotHost", () => {
  const laptop = EnvironmentId.make("laptop");
  const server = EnvironmentId.make("server");
  const environments = [
    { environmentId: laptop, label: "Laptop", connected: true, supportsBots: true },
    { environmentId: server, label: "Server", connected: true, supportsBots: true },
  ];

  it("creates on the Assistant's environment until a default host is chosen", () => {
    expect(
      resolveNewBotHost({
        sourceEnvironmentId: laptop,
        defaultBotEnvironmentId: null,
        environments,
      }),
    ).toEqual({ kind: "ready", environmentId: laptop, label: "Laptop" });
    expect(
      resolveNewBotHost({
        sourceEnvironmentId: laptop,
        defaultBotEnvironmentId: server,
        environments,
      }),
    ).toEqual({ kind: "ready", environmentId: server, label: "Server" });
  });

  it("reports an unreachable default host instead of creating somewhere else", () => {
    const offline = environments.map((entry) =>
      entry.environmentId === server ? { ...entry, connected: false } : entry,
    );
    expect(
      resolveNewBotHost({
        sourceEnvironmentId: laptop,
        defaultBotEnvironmentId: server,
        environments: offline,
      }),
    ).toMatchObject({ kind: "unavailable", environmentId: server, reason: "Server is offline." });
    expect(
      resolveNewBotHost({
        sourceEnvironmentId: laptop,
        defaultBotEnvironmentId: EnvironmentId.make("elsewhere"),
        environments,
      }),
    ).toMatchObject({ kind: "unavailable", environmentId: "elsewhere" });
    const old = environments.map((entry) =>
      entry.environmentId === server ? { ...entry, supportsBots: false } : entry,
    );
    expect(
      resolveNewBotHost({
        sourceEnvironmentId: laptop,
        defaultBotEnvironmentId: server,
        environments: old,
      }),
    ).toMatchObject({ kind: "unavailable", environmentId: server });
  });
});

describe("shared bot defaults", () => {
  const defaults = {
    defaultModelSelection: claude,
    defaultRuntimeMode: "approval-required" as const,
  };
  const target = {
    environmentId: EnvironmentId.make("one"),
    connected: true,
    supported: true,
    canWrite: true,
    settings: DEFAULT_SERVER_SETTINGS,
    providers,
  };
  it("writes the same defaults to every destination without changing per-bot overrides", () => {
    const plan = planSharedBotDefaults({
      defaults,
      sourceSettings: DEFAULT_SERVER_SETTINGS,
      targets: [target, { ...target, environmentId: EnvironmentId.make("two") }],
    });
    expect(plan.error).toBeNull();
    expect(plan.writes.map((write) => write.patch)).toEqual([
      { botDefaults: defaults },
      { botDefaults: defaults },
    ]);
  });
  it.each([{ connected: false }, { canWrite: false }, { supported: false }, { providers: [] }])(
    "does not partially start a shared edit when a destination is unavailable: %j",
    (change) => {
      const plan = planSharedBotDefaults({
        defaults,
        sourceSettings: DEFAULT_SERVER_SETTINGS,
        targets: [target, { ...target, environmentId: EnvironmentId.make("two"), ...change }],
      });
      expect(plan.error).not.toBeNull();
      expect(plan.writes).toEqual([]);
    },
  );
});
