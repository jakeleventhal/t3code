import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PersonalBackgroundConfig from "./PersonalBackgroundConfig.ts";

const load = (env: Record<string, string>, exists: () => Effect.Effect<boolean>) =>
  PersonalBackgroundConfig.PersonalBackgroundConfig.pipe(
    Effect.provide(
      PersonalBackgroundConfig.layer.pipe(
        Layer.provide([
          ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
          Path.layer,
          FileSystem.layerNoop({
            exists,
            readFileString: () =>
              Effect.succeed(
                JSON.stringify({
                  url: "https://relay.example.test/",
                  environmentCredential: "test-credential",
                }),
              ),
          }),
        ]),
      ),
    ),
  );

describe("PersonalBackgroundConfig", () => {
  it.effect("does not access personal relay credentials when explicitly disabled", () =>
    Effect.gen(function* () {
      const value = yield* load({ T3CODE_DISABLE_PERSONAL_RELAY: "true" }, () =>
        Effect.die("Personal files must not be read"),
      );
      expect(value).toBeNull();
    }),
  );
  it.effect("keeps installed relay configuration when the override is absent", () =>
    Effect.gen(function* () {
      expect(yield* load({}, () => Effect.succeed(true))).toEqual({
        url: "https://relay.example.test",
        environmentCredential: "test-credential",
      });
    }),
  );
});
