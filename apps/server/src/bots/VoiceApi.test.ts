import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as VoiceApi from "./VoiceApi.ts";

const liveInput = {
  apiKey: Redacted.make("private-api-key"),
  model: "gpt-live-1",
  voice: "marin",
  sdp: "local-offer",
  instructions: "Use the current conversation; send deeper work to the chosen harness.",
  history: [
    { role: "user" as const, text: "Remember comet-427." },
    { role: "assistant" as const, text: "comet-427 saved." },
  ],
};

function jsonBody(request: HttpClientRequest.HttpClientRequest): unknown {
  if (request.body._tag !== "Uint8Array") throw new Error("Expected a JSON body");
  return JSON.parse(new TextDecoder().decode(request.body.body));
}

it.effect(
  "creates a direct Live call with saved text, client delegation, and recording disabled",
  () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    const http = HttpClient.make((request) => {
      requests.push(request);
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            {
              session: { id: "live_opaque", extra: "ignored" },
              transport: { type: "webrtc", sdp: "remote-answer" },
            },
            { status: 201 },
          ),
        ),
      );
    });
    return Effect.gen(function* () {
      const api = yield* VoiceApi.VoiceApi;
      const result = yield* api.openLive(liveInput);
      assert.deepEqual(result, {
        session: { id: "live_opaque" },
        transport: { type: "webrtc", sdp: "remote-answer" },
      });
      assert.equal(requests.length, 1);
      const request = requests[0]!;
      assert.equal(request.url, "https://api.openai.com/v1/live/sessions");
      assert.equal(request.headers.authorization, "Bearer private-api-key");
      assert.deepEqual(jsonBody(request), {
        session: {
          model: "gpt-live-1",
          audio: { output: { voice: "marin" } },
          instructions: liveInput.instructions,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Remember comet-427." }],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "comet-427 saved." }],
            },
          ],
          delegation: { type: "client" },
          store: false,
        },
        transport: { type: "webrtc", sdp: "local-offer" },
      });
    }).pipe(
      Effect.provide(
        VoiceApi.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http))),
      ),
    );
  },
);

it.effect(
  "mints a Grok client credential without OpenAI-only session fields or the long-lived key",
  () => {
    const http = HttpClient.make((request) => {
      assert.equal(request.url, "https://api.x.ai/v1/realtime/client_secrets");
      assert.deepEqual(jsonBody(request), { expires_after: { seconds: 60 } });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ value: "ephemeral-secret", expires_at: 1790000060 }),
        ),
      );
    });
    return Effect.gen(function* () {
      const api = yield* VoiceApi.VoiceApi;
      assert.deepEqual(yield* api.grokClientSecret(liveInput.apiKey), {
        value: "ephemeral-secret",
        expires_at: 1790000060,
      });
    }).pipe(
      Effect.provide(
        VoiceApi.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http))),
      ),
    );
  },
);

it.effect.each([
  [401, "credentials-refused"],
  [403, "credentials-refused"],
  [429, "rate-limited"],
  [502, "request-failed"],
] as const)(
  "reports %s without retrying creation or exposing the provider response",
  ([status, reason]) => {
    let attempts = 0;
    const http = HttpClient.make((request) => {
      attempts++;
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ message: "private upstream data" }, { status }),
        ),
      );
    });
    return Effect.gen(function* () {
      const api = yield* VoiceApi.VoiceApi;
      const result = yield* api.openLive(liveInput).pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.equal(result.failure.reason, reason);
        assert.equal(result.failure.status, status);
        assert.notInclude(result.failure.message, "private");
      }
      assert.equal(attempts, 1);
    }).pipe(
      Effect.provide(
        VoiceApi.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http))),
      ),
    );
  },
);

it.effect("rejects a success response without a usable remote description", () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "" } }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const api = yield* VoiceApi.VoiceApi;
    const result = yield* api.openLive(liveInput).pipe(Effect.result);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.equal(result.failure.reason, "invalid-response");
  }).pipe(
    Effect.provide(VoiceApi.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http)))),
  );
});

it.effect("times out a stalled provider once and releases its request", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let attempts = 0;
    const http = HttpClient.make(() =>
      Effect.gen(function* () {
        attempts++;
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)));
      }),
    );
    const fiber = yield* VoiceApi.VoiceApi.pipe(
      Effect.flatMap((api) => api.openLive(liveInput)),
      Effect.result,
      Effect.provide(
        VoiceApi.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http))),
      ),
      Effect.forkChild,
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("20 seconds");
    const result = yield* Fiber.join(fiber);
    yield* Deferred.await(interrupted);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.equal(result.failure.reason, "request-failed");
    assert.equal(attempts, 1);
  }),
);
