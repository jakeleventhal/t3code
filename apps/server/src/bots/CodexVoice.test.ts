import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerSettings from "../serverSettings.ts";
import * as CodexVoice from "./CodexVoice.ts";

it.effect(
  "exports the selected CLI sign-in, keeps credentials server-side, and never starts a backing Codex turn",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-voice-test-" });
      const binaryPath = path.join(directory, "fake-codex");
      const requestLog = path.join(directory, "requests");
      yield* fs.writeFileString(
        binaryPath,
        `#!${process.execPath}
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
createInterface({ input: process.stdin }).on("line", (line) => {
  const input = JSON.parse(line);
  appendFileSync(${JSON.stringify(requestLog)}, input.method + "\\n");
  if (input.id === undefined) return;
  const results = {
    initialize: { codexHome: ${JSON.stringify(directory)}, userAgent: "codex/0.164.0", platformFamily: "unix", platformOs: "macos" },
    getAuthStatus: { authMethod: "chatgpt", authToken: "fake-subscription-token", requiresOpenaiAuth: true },
    "account/read": { account: { type: "chatgpt", email: "test@example.com", planType: "pro" }, requiresOpenaiAuth: true, workspaceRouting: { backendOrigin: "https://us.chatgpt.com", chatgptAccountId: "selected-workspace", accountRoutingOverride: "us" } },
    "account/rateLimits/read": { accountId: "selected-workspace", rateLimits: { primary: null, secondary: null, credits: null, planType: "pro" } },
  };
  const result = results[input.method];
  process.stdout.write(JSON.stringify(result === undefined ? { id: input.id, error: { code: -32601, message: "Unexpected request" } } : { id: input.id, result }) + "\\n");
});
`,
      );
      yield* fs.chmod(binaryPath, 0o755);
      let requests = 0;
      const http = HttpClient.make((request) => {
        requests++;
        assert.equal(
          request.url,
          "https://us.chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
        );
        assert.equal(request.headers.authorization, "Bearer fake-subscription-token");
        assert.equal(request.headers["chatgpt-account-id"], "selected-workspace");
        assert.equal(request.body._tag, "Uint8Array");
        if (request.body._tag !== "Uint8Array") return Effect.die("Expected JSON");
        const body = JSON.parse(new TextDecoder().decode(request.body.body));
        assert.equal(body.sdp, "offer");
        assert.equal(body.session.delegation.type, "client");
        assert.notProperty(body.session, "model");
        assert.equal(body.session.initial_items[0].content[0].text, "The gym is Cedar Gate.");
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("v=0\r\nanswer", {
              status: 201,
              headers: { Location: "/v1/live/subscription-call" },
            }),
          ),
        );
      });
      const instanceId = ProviderInstanceId.make("existing-codex");
      const result = yield* Effect.gen(function* () {
        return yield* (yield* CodexVoice.CodexVoice).connect({
          providerInstanceId: instanceId,
          cwd: directory,
          voice: "marin",
          sdp: "offer",
          instructions: "Use the chosen work agent.",
          history: [{ role: "user", text: "The gym is Cedar Gate." }],
        });
      }).pipe(
        Effect.provide(
          CodexVoice.layer.pipe(
            Layer.provide(
              ServerSettings.layerTest({
                providerInstances: {
                  [instanceId]: {
                    driver: ProviderDriverKind.make("codex"),
                    config: { setupMode: "existing", binaryPath, homePath: directory },
                  },
                },
              }),
            ),
            Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
          ),
        ),
      );
      assert.deepEqual(result, {
        sessionId: "subscription-call",
        sdp: "v=0\r\nanswer",
        protocol: "codex",
      });
      assert.equal(requests, 1);
      const methods = (yield* fs.readFileString(requestLog)).trim().split("\n");
      assert.deepEqual(methods, [
        "initialize",
        "initialized",
        "getAuthStatus",
        "account/read",
        "account/rateLimits/read",
      ]);
      assert.notInclude(JSON.stringify(result), "fake-subscription-token");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
