import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, VoiceCatalog } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";
import * as VoiceConfiguration from "./VoiceConfiguration.ts";
const isVoiceCatalog = Schema.is(VoiceCatalog);

const testLayer = () =>
  VoiceConfiguration.layer.pipe(
    Layer.provideMerge(ServerSettings.layer),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-bot-voice-settings-" })),
    ),
  );

it.layer(NodeServices.layer)("bot voice configuration", (it) => {
  it.effect("keeps API keys out of settings files, client settings, and the catalog", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const voice = yield* VoiceConfiguration.VoiceConfiguration;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const saved = yield* settings.updateSettings({
        voiceConnections: {
          personal: { kind: "openai-api", name: "Personal", apiKey: "test-private-openai" },
          work: { kind: "xai-api", name: "Work", apiKey: "test-private-xai" },
          empty: { kind: "xai-api", name: "Empty", apiKey: "" },
          plan: {
            kind: "codex-subscription",
            name: "Plan",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
        },
      });
      const client = ServerSettings.redactServerSettingsForClient(saved);
      const catalog = yield* voice.catalog();
      const disk = yield* fs.readFileString(config.settingsPath);
      for (const value of ["test-private-openai", "test-private-xai"]) {
        assert.notInclude(disk, value);
        assert.notInclude(JSON.stringify(client), value);
        assert.notInclude(JSON.stringify(catalog), value);
      }
      assert.isTrue(isVoiceCatalog(catalog));
      assert.deepEqual(
        catalog.connections.map(({ id, status }) => [id, status]),
        [
          ["personal", "configured"],
          ["work", "configured"],
          ["empty", "missing-credentials"],
          ["plan", "configured"],
        ],
      );
      assert.isAtLeast(catalog.connections[0]!.models[0]!.voices.length, 2);
      assert.isAbove(catalog.connections[3]!.models.length, 0);
      const echoed = yield* settings.updateSettings({ voiceConnections: client.voiceConnections });
      assert.propertyVal(echoed.voiceConnections.personal, "apiKey", "test-private-openai");
      assert.propertyVal(echoed.voiceConnections.work, "apiKey", "test-private-xai");
      const reloaded = yield* Effect.gen(function* () {
        return yield* (yield* ServerSettings.ServerSettingsService).getSettings;
      }).pipe(Effect.provide(Layer.fresh(ServerSettings.layer)));
      assert.propertyVal(reloaded.voiceConnections.personal, "apiKey", "test-private-openai");
      assert.propertyVal(reloaded.voiceConnections.work, "apiKey", "test-private-xai");
    }).pipe(Effect.provide(testLayer())),
  );

  it.effect(
    "clears deleted credentials and never reuses them for another provider or account",
    () =>
      Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        yield* settings.updateSettings({
          voiceConnections: {
            personal: { kind: "openai-api", name: "Personal", apiKey: "test-private-key" },
          },
        });
        const changed = yield* settings.updateSettings({
          voiceConnections: {
            personal: { kind: "xai-api", name: "Grok", apiKey: SECRET_REDACTED },
            other: { kind: "openai-api", name: "Other", apiKey: SECRET_REDACTED },
          },
        });
        assert.propertyVal(changed.voiceConnections.personal, "apiKey", "");
        assert.propertyVal(changed.voiceConnections.other, "apiKey", "");
        yield* settings.updateSettings({ voiceConnections: { personal: null } });
        const recreated = yield* settings.updateSettings({
          voiceConnections: {
            personal: { kind: "openai-api", name: "Personal", apiKey: SECRET_REDACTED },
          },
        });
        assert.propertyVal(recreated.voiceConnections.personal, "apiKey", "");
      }).pipe(Effect.provide(testLayer())),
  );

  it.effect("persists the environment voice and explicit bot null across a service restart", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const bot = ProjectId.make("fitness");
      const selection = { connectionId: "personal", model: "gpt-live-1", voice: "marin" };
      yield* settings.updateSettings({
        voiceSelection: selection,
        projectSettingsOverrides: { [bot]: { voiceSelection: null } },
      });
      const reloaded = yield* Effect.gen(function* () {
        return yield* (yield* ServerSettings.ServerSettingsService).getSettings;
      }).pipe(Effect.provide(Layer.fresh(ServerSettings.layer)));
      assert.deepEqual(reloaded.voiceSelection, selection);
      assert.deepEqual(reloaded.projectSettingsOverrides[bot], { voiceSelection: null });
      const reset = yield* settings.updateSettings({
        voiceSelection: null,
        projectSettingsOverrides: { [bot]: {} },
      });
      assert.isNull(reset.voiceSelection);
      assert.notProperty(reset.projectSettingsOverrides[bot] ?? {}, "voiceSelection");
    }).pipe(Effect.provide(testLayer())),
  );
});
