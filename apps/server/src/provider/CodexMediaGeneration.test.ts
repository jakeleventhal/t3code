import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CodexSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { vi } from "vite-plus/test";
import { makeCodexMediaGeneration } from "./CodexMediaGeneration.ts";

const fixture = vi.hoisted(() => ({ native: true, failed: false }));
vi.mock("./CodexProvider.ts", () => ({
  withCodexAppServerClient: () =>
    Effect.sync(() => {
      const handlers = new Map<string, (payload: never) => Effect.Effect<void>>();
      return {
        client: {
          handleServerNotification: (
            method: string,
            handler: (payload: never) => Effect.Effect<void>,
          ) =>
            Effect.sync(() => {
              handlers.set(method, handler);
            }),
          request: (method: string) =>
            Effect.gen(function* () {
              if (method === "thread/start") return { thread: { id: "image-thread" } };
              yield* handlers.get("item/completed")!({
                item: fixture.native
                  ? {
                      type: "imageGeneration",
                      status: "completed",
                      savedPath: "/tmp/native-image.png",
                      failure: fixture.failed ? {} : null,
                    }
                  : { type: "agentMessage", text: "Generated /tmp/fabricated.png" },
              } as never);
              yield* handlers.get("turn/completed")!({ turn: { status: "completed" } } as never);
              return {};
            }),
        },
      };
    }),
}));

const codexSettings = Schema.decodeSync(CodexSettings)({});

const generate = Effect.gen(function* () {
  const media = yield* makeCodexMediaGeneration(codexSettings, {});
  return yield* media.generateImages({ cwd: "/tmp", prompts: ["a robot"], aspectRatio: "1:1" });
}).pipe(
  Effect.provide(NodeServices.layer),
  Effect.provideService(HostProcess.HomeDirectory, "/tmp"),
);

it.effect("accepts only the native image-generation receipt", () => {
  fixture.native = true;
  fixture.failed = false;
  return generate.pipe(
    Effect.map((result) => {
      assert.deepEqual(result.paths, ["/tmp/native-image.png"]);
    }),
  );
});

it.effect("rejects fabricated image paths in an ordinary reply", () => {
  fixture.native = false;
  fixture.failed = false;
  return generate.pipe(
    Effect.flip,
    Effect.map((error) => {
      assert.equal(error.reason, "refused");
    }),
  );
});

it.effect("rejects a failed native image result even if it names a path", () => {
  fixture.native = true;
  fixture.failed = true;
  return generate.pipe(
    Effect.flip,
    Effect.map((error) => {
      assert.equal(error.reason, "refused");
    }),
  );
});
