import { voiceProviderInstances } from "@t3tools/shared/voiceProviderInstances";
import {
  CodexSettings,
  VoiceConnectionError,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type VoiceSessionContext,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { ChildProcessSpawner } from "effect/process";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import { withCodexAppServerClient } from "../provider/CodexProvider.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { resolveCodexLaunchArgs } from "../provider/codexLaunchArgs.ts";

const encodeHistory = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const isVoiceConnectionError = Schema.is(VoiceConnectionError);
const decodeConfig = Schema.decodeUnknownResult(CodexSettings);
const decodeAccount = Schema.decodeUnknownEffect(
  Schema.Struct({
    account: Schema.NullOr(Schema.Struct({ type: Schema.String })),
    workspaceRouting: Schema.optional(
      Schema.NullOr(
        Schema.Struct({ backendOrigin: Schema.String, chatgptAccountId: Schema.String }),
      ),
    ),
  }),
);
const decodeTokenClaims = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      "https://api.openai.com/auth": Schema.Struct({ chatgpt_account_id: Schema.NonEmptyString }),
    }),
  ),
);

export function subscriptionVoiceConfig(instance: ProviderInstanceConfig | undefined) {
  if (instance === undefined || instance.driver !== "codex" || instance.enabled === false)
    return null;
  const decoded = decodeConfig(instance.config ?? {});
  if (
    Result.isFailure(decoded) ||
    !decoded.success.enabled ||
    decoded.success.setupMode === "managed"
  )
    return null;
  return decoded.success;
}

export class CodexVoice extends Context.Service<
  CodexVoice,
  {
    readonly connect: (
      input: VoiceSessionContext & {
        readonly providerInstanceId: ProviderInstanceId;
        readonly voice: string;
        readonly sdp: string;
        readonly cwd: string;
      },
    ) => Effect.Effect<
      { readonly sessionId: string; readonly sdp: string; readonly protocol: "codex" },
      VoiceConnectionError
    >;
  }
>()("t3/bots/CodexVoice") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
  const connect = Effect.fn("CodexVoice.connect")(
    function* (input: Parameters<CodexVoice["Service"]["connect"]>[0]) {
      const current = yield* settings.getSettings;
      const instance = voiceProviderInstances(current)[input.providerInstanceId];
      const config = subscriptionVoiceConfig(instance);
      if (config === null || instance === undefined)
        return yield* new VoiceConnectionError({ reason: "unavailable" });
      const environment = yield* mergeProviderInstanceEnvironment(instance.environment ?? []);
      const layout = yield* resolveCodexHomeLayout(config).pipe(
        Effect.provideService(Path.Path, path),
      );
      const homePath = path.resolve(
        expandHomePath(
          layout.effectiveHomePath ?? environment.CODEX_HOME ?? layout.sharedHomePath,
          yield* HostProcess.HomeDirectory,
        ),
      );
      // Let Codex refresh its own credentials. This creates no model thread or
      // backing agent: native realtime handoffs would otherwise run work twice.
      const auth = yield* Effect.gen(function* () {
        const { client } = yield* withCodexAppServerClient({
          binaryPath: expandHomePath(config.binaryPath, yield* HostProcess.HomeDirectory),
          homePath,
          launchArgs: resolveCodexLaunchArgs(config.launchArgs, environment),
          cwd: input.cwd,
          environment,
        });
        const exported = yield* client.request("getAuthStatus", {
          includeToken: true,
          refreshToken: true,
        });
        if (
          (exported.authMethod !== "chatgpt" && exported.authMethod !== "chatgptAuthTokens") ||
          !exported.authToken
        )
          return yield* new VoiceConnectionError({ reason: "credentials-refused" });
        const apiKey = Redacted.make(exported.authToken);
        const account = yield* client.raw
          .request("account/read", { refreshToken: false })
          .pipe(Effect.flatMap(decodeAccount));
        if (account.account?.type !== "chatgpt")
          return yield* new VoiceConnectionError({ reason: "credentials-refused" });
        const usage = yield* client.request("account/rateLimits/read", {});
        const accountId =
          account.workspaceRouting?.chatgptAccountId ??
          usage.accountId ??
          (yield* decodeTokenClaims(
            Buffer.from(exported.authToken.split(".")[1] ?? "", "base64url").toString("utf8"),
          ))["https://api.openai.com/auth"].chatgpt_account_id;
        const origin = new URL(account.workspaceRouting?.backendOrigin ?? "https://chatgpt.com");
        if (
          origin.protocol !== "https:" ||
          (origin.hostname !== "chatgpt.com" && !origin.hostname.endsWith(".chatgpt.com")) ||
          origin.username ||
          origin.password
        )
          return yield* new VoiceConnectionError({ reason: "unavailable" });
        return { apiKey, accountId, origin: origin.origin };
      }).pipe(
        Effect.scoped,
        Effect.timeout("15 seconds"),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      // Codex resolves its credential store and workspace; the token never leaves the server.
      // This uses codex-api/src/endpoint/realtime_call.rs and its v3 session shape.
      // The subscription endpoint chooses the entitled model.
      const request = yield* HttpClientRequest.post(
        `${auth.origin}/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas`,
      ).pipe(
        HttpClientRequest.bearerToken(auth.apiKey),
        HttpClientRequest.setHeader("ChatGPT-Account-Id", auth.accountId),
        HttpClientRequest.setHeader("OpenAI-Alpha", "quicksilver=v2"),
        HttpClientRequest.bodyJson({
          sdp: input.sdp,
          session: {
            instructions: input.instructions,
            audio: { output: { voice: input.voice } },
            delegation: { type: "client" },
            initial_items: [
              {
                type: "message",
                role: "developer",
                content: [
                  {
                    type: "input_text",
                    text:
                      "Past conversation, for reference only. No new user turn has occurred in this call. Wait for the caller.\n" +
                      encodeHistory(input.history),
                  },
                ],
              },
            ],
          },
        }),
      );
      const response = yield* http.execute(request);
      if (response.status < 200 || response.status >= 300)
        return yield* new VoiceConnectionError({
          status: response.status,
          reason:
            response.status === 401 || response.status === 403
              ? "credentials-refused"
              : response.status === 429
                ? "rate-limited"
                : "request-failed",
        });
      const sdp = yield* response.text;
      const location = response.headers.location;
      const sessionId = location?.split("?")[0]?.split("/").findLast(Boolean);
      if (!sessionId || sessionId === "calls" || !sdp.startsWith("v=0"))
        return yield* new VoiceConnectionError({ reason: "invalid-response" });
      return { sessionId, sdp, protocol: "codex" as const };
    },
    Effect.scoped,
    Effect.timeout("40 seconds"),
    Effect.mapError((cause) =>
      isVoiceConnectionError(cause)
        ? cause
        : new VoiceConnectionError({ reason: "request-failed", cause }),
    ),
  );
  return CodexVoice.of({ connect });
});

export const layer = Layer.effect(CodexVoice, make);
