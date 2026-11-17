import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { WidgetRevocationRateLimiter, WIDGET_REVOCATION_RATE_LIMIT } from "./AgentWidgetRefresh.ts";

export const layer = Layer.effect(
  WidgetRevocationRateLimiter,
  Effect.gen(function* () {
    const window = yield* Ref.make({ start: 0, count: 0 });
    return {
      allow: Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        return yield* Ref.modify(window, (previous) => {
          const current =
            now - previous.start >= WIDGET_REVOCATION_RATE_LIMIT.periodSeconds * 1_000
              ? { start: now, count: 0 }
              : previous;
          const allowed = current.count < WIDGET_REVOCATION_RATE_LIMIT.limit;
          return [allowed, allowed ? { ...current, count: current.count + 1 } : current];
        });
      }),
    };
  }),
);
