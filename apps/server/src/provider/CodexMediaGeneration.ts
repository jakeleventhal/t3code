import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/process";
import type { CodexSettings } from "@t3tools/contracts";
import {
  ProviderMediaGenerationError,
  type ImageGenerationInput,
  type ProviderMediaGeneration,
} from "@t3tools/provider-core/server/mediaGeneration";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { withCodexAppServerClient } from "./CodexProvider.ts";
import { resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";

const isMediaError = Schema.is(ProviderMediaGenerationError);

export const makeCodexMediaGeneration = Effect.fn("makeCodexMediaGeneration")(function* (
  config: CodexSettings,
  environment: NodeJS.ProcessEnv,
  resolveRuntime?: Effect.Effect<
    import("./CodexManagedRuntime.ts").CodexEffectiveRuntime,
    import("@t3tools/contracts").ProviderSetupError,
    Scope.Scope
  >,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const home = yield* HostProcess.HomeDirectory;

  const generateImage = Effect.fn("CodexMediaGeneration.generateImage")(
    function* (cwd: string, prompt: string) {
      const resolved = resolveRuntime ? yield* resolveRuntime : undefined;
      const effectiveConfig = resolved?.config ?? config;
      const effectiveEnvironment = resolved?.environment ?? environment;
      const { client } = yield* withCodexAppServerClient({
        binaryPath: effectiveConfig.binaryPath || "codex",
        homePath: effectiveConfig.homePath,
        launchArgs: resolveCodexLaunchArgs(effectiveConfig.launchArgs, effectiveEnvironment),
        cwd,
        environment: effectiveEnvironment,
      });
      const completed = yield* Deferred.make<void>();
      let savedPath: string | null = null;
      let failed = false;
      yield* client.handleServerNotification("item/completed", ({ item }) =>
        Effect.sync(() => {
          // Only the native tool receipt can name an image; never trust a path in prose.
          if (item.type === "imageGeneration" && item.status === "completed" && !item.failure) {
            savedPath = item.savedPath ?? null;
          }
        }),
      );
      yield* client.handleServerNotification("turn/completed", ({ turn }) =>
        Effect.sync(() => {
          failed = turn.status !== "completed";
        }).pipe(Effect.andThen(Deferred.succeed(completed, undefined)), Effect.asVoid),
      );
      const started = yield* client.request("thread/start", {
        cwd,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        config: { "features.plugins": false, "features.apps": false },
        baseInstructions:
          "Generate the requested avatar with your native image generation tool and save it. Use no plugins, external tools, shell commands, or file editing. If native image generation is unavailable, say so and stop.",
      });
      yield* client.request("turn/start", {
        threadId: started.thread.id,
        input: [{ type: "text", text: `Generate one square image. ${prompt}`, text_elements: [] }],
      });
      yield* Deferred.await(completed);
      if (failed || savedPath === null) {
        return yield* new ProviderMediaGenerationError({
          operation: "generateImages",
          reason: "refused",
          providerMessage:
            "Codex did not return a generated image. Check image generation availability on this account.",
        });
      }
      return savedPath;
    },
    Effect.scoped,
    Effect.timeout("4 minutes"),
    Effect.mapError((cause) =>
      isMediaError(cause)
        ? cause
        : new ProviderMediaGenerationError({
            operation: "generateImages",
            reason: "failed",
            cause,
          }),
    ),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(HostProcess.HomeDirectory, home),
  );

  return {
    generateImages: Effect.fn("CodexMediaGeneration.generateImages")(function* (
      input: ImageGenerationInput,
    ) {
      const paths = yield* Effect.forEach(input.prompts, (prompt) =>
        generateImage(input.cwd, prompt),
      );
      return { paths };
    }),
  } satisfies ProviderMediaGeneration;
});
