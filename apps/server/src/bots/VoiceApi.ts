import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

export class VoiceApiError extends Schema.TaggedError<VoiceApiError>()("VoiceApiError", {
  provider: Schema.Literals(["openai-live", "grok"]),
  reason: Schema.Literals([
    "credentials-refused",
    "rate-limited",
    "request-failed",
    "invalid-response",
  ]),
  status: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "credentials-refused":
        return "The voice provider did not accept these credentials.";
      case "rate-limited":
        return "The voice provider's usage limit was reached.";
      case "request-failed":
        return "Could not connect to the voice provider.";
      case "invalid-response":
        return "The voice provider returned an invalid connection response.";
    }
  }
}

interface LiveSessionInput {
  readonly apiKey: Redacted.Redacted<string>;
  readonly model: string;
  readonly voice: string;
  readonly sdp: string;
  readonly instructions: string;
  readonly history: ReadonlyArray<{
    readonly role: "developer" | "user" | "assistant";
    readonly text: string;
  }>;
}

const LiveConnection = Schema.Struct({
  session: Schema.Struct({ id: Schema.NonEmptyString }),
  transport: Schema.Struct({ type: Schema.Literal("webrtc"), sdp: Schema.NonEmptyString }),
});
const GrokClientSecret = Schema.Struct({
  value: Schema.NonEmptyString,
  expires_at: Schema.Int.check(Schema.isGreaterThan(0)),
});

/** Only connection setup crosses the environment; media stays between client and provider. */
export class VoiceApi extends Context.Service<
  VoiceApi,
  {
    readonly openLive: (
      input: LiveSessionInput,
    ) => Effect.Effect<typeof LiveConnection.Type, VoiceApiError>;
    readonly grokClientSecret: (
      apiKey: Redacted.Redacted<string>,
    ) => Effect.Effect<typeof GrokClientSecret.Type, VoiceApiError>;
  }
>()("t3/bots/VoiceApi") {}

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);

  const post = Effect.fn("VoiceApi.post")(function* <A, I>(input: {
    readonly provider: VoiceApiError["provider"];
    readonly url: string;
    readonly apiKey: Redacted.Redacted<string>;
    readonly body: unknown;
    readonly schema: Schema.Codec<A, I>;
  }) {
    const request = yield* HttpClientRequest.post(input.url).pipe(
      HttpClientRequest.bearerToken(input.apiKey),
      HttpClientRequest.bodyJson(input.body),
      Effect.mapError(
        (cause) => new VoiceApiError({ provider: input.provider, reason: "request-failed", cause }),
      ),
    );
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.mapError(
          (cause) =>
            new VoiceApiError({ provider: input.provider, reason: "request-failed", cause }),
        ),
      );
    if (response.status < 200 || response.status >= 300) {
      return yield* new VoiceApiError({
        provider: input.provider,
        reason:
          response.status === 401 || response.status === 403
            ? "credentials-refused"
            : response.status === 429
              ? "rate-limited"
              : "request-failed",
        status: response.status,
      });
    }
    return yield* HttpClientResponse.schemaBodyJson(input.schema)(response).pipe(
      Effect.mapError(
        (cause) =>
          new VoiceApiError({ provider: input.provider, reason: "invalid-response", cause }),
      ),
    );
  }, Effect.scoped);

  const openLive = Effect.fn("VoiceApi.openLive")(function* (input: LiveSessionInput) {
    // Replaying a timed-out creation can create a second billable call, so this request never retries.
    return yield* post({
      provider: "openai-live",
      url: "https://api.openai.com/v1/live/sessions",
      apiKey: input.apiKey,
      schema: LiveConnection,
      body: {
        session: {
          model: input.model,
          audio: { output: { voice: input.voice } },
          instructions: input.instructions,
          input: input.history.map((message) => ({
            type: "message",
            role: message.role,
            content: [
              {
                type: message.role === "assistant" ? "output_text" : "input_text",
                text: message.text,
              },
            ],
          })),
          delegation: { type: "client" },
          store: false,
        },
        transport: { type: "webrtc", sdp: input.sdp },
      },
    }).pipe(
      Effect.timeout("20 seconds"),
      Effect.catchTags({
        TimeoutError: (cause) =>
          Effect.fail(
            new VoiceApiError({ provider: "openai-live", reason: "request-failed", cause }),
          ),
      }),
    );
  });

  const grokClientSecret = Effect.fn("VoiceApi.grokClientSecret")(function* (
    apiKey: Redacted.Redacted<string>,
  ) {
    // Grok rejects OpenAI's session and expiration-anchor fields on its token endpoint.
    return yield* post({
      provider: "grok",
      url: "https://api.x.ai/v1/realtime/client_secrets",
      apiKey,
      body: { expires_after: { seconds: 60 } },
      schema: GrokClientSecret,
    }).pipe(
      Effect.timeout("20 seconds"),
      Effect.catchTags({
        TimeoutError: (cause) =>
          Effect.fail(new VoiceApiError({ provider: "grok", reason: "request-failed", cause })),
      }),
    );
  });

  return VoiceApi.of({ openLive, grokClientSecret });
});

export const layer = Layer.effect(VoiceApi, make);
