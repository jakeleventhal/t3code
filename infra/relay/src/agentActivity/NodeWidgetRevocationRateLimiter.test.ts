import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { WidgetRevocationRateLimiter, WIDGET_REVOCATION_RATE_LIMIT } from "./AgentWidgetRefresh.ts";
import { layer } from "./NodeWidgetRevocationRateLimiter.ts";

it.effect("bounds concurrent revocations and reopens the next window", () =>
  Effect.gen(function* () {
    const limiter = yield* WidgetRevocationRateLimiter;
    const results = yield* Effect.forEach(
      Array.from({ length: WIDGET_REVOCATION_RATE_LIMIT.limit + 10 }),
      () => limiter.allow,
      { concurrency: "unbounded" },
    );
    assert.equal(results.filter(Boolean).length, WIDGET_REVOCATION_RATE_LIMIT.limit);
    yield* TestClock.adjust(`${WIDGET_REVOCATION_RATE_LIMIT.periodSeconds} seconds`);
    assert.isTrue(yield* limiter.allow);
  }).pipe(Effect.provide(layer)),
);
