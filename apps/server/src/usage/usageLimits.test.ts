// @effect-diagnostics nodeBuiltinImport:off - the suite removes the temp state
// directory it persisted into, outside the store's Effect FileSystem.
import * as NodeFSP from "node:fs/promises";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeAccountRateLimitsUpdatedEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  limitsFromRuntimeEvent,
  make,
  mergeProviderLimits,
  parseClaudeRateLimitEvent,
  parseCodexRateLimits,
  parseCodexRateLimitsRead,
  resolveCodexRefreshSettings,
} from "./usageLimits.ts";

const OBSERVED_AT = "2026-08-10T12:00:00.000Z";
const LATER = "2026-08-10T13:00:00.000Z";

function rateLimitEvent(
  provider: string,
  rateLimits: unknown,
): ProviderRuntimeAccountRateLimitsUpdatedEvent {
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make("evt-1"),
    provider: ProviderDriverKind.make(provider),
    threadId: ThreadId.make("thread-1"),
    createdAt: OBSERVED_AT,
    payload: { rateLimits },
  };
}

describe("parseCodexRateLimits", () => {
  it("names Codex's unnamed windows by their length", () => {
    const limits = parseCodexRateLimits(
      {
        planType: "pro",
        primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_786_200_000 },
        secondary: { usedPercent: 18, windowDurationMins: 10_080, resetsAt: null },
      },
      OBSERVED_AT,
    );

    assert.deepStrictEqual(limits, {
      provider: "codex",
      plan: "Pro",
      windows: [
        {
          id: "five_hour",
          scope: null,
          durationMinutes: 300,
          usedPercent: 42,
          resetsAt: "2026-08-08T14:40:00.000Z",
          observedAt: OBSERVED_AT,
        },
        {
          id: "seven_day",
          scope: null,
          durationMinutes: 10_080,
          usedPercent: 18,
          resetsAt: null,
          observedAt: OBSERVED_AT,
        },
      ],
    });
  });

  it("keeps Codex's own key for a window of unfamiliar length", () => {
    const limits = parseCodexRateLimits(
      { primary: { usedPercent: 5, windowDurationMins: 60 } },
      OBSERVED_AT,
    );
    assert.strictEqual(limits?.windows[0]?.id, "primary");
    assert.strictEqual(limits?.plan, null);
  });

  it("keeps separately metered buckets apart from the plan's own windows", () => {
    const limits = parseCodexRateLimitsRead(
      {
        rateLimits: {
          limitId: "codex",
          planType: "pro",
          primary: { usedPercent: 16, windowDurationMins: 10_080, resetsAt: null },
          secondary: null,
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            primary: { usedPercent: 16, windowDurationMins: 10_080, resetsAt: null },
          },
          codex_spark: {
            limitId: "codex_spark",
            limitName: "GPT-5.3-Codex-Spark",
            primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: null },
            secondary: { usedPercent: 1, windowDurationMins: 10_080, resetsAt: null },
          },
        },
      },
      OBSERVED_AT,
    );

    assert.deepStrictEqual(
      limits?.windows.map((window) => [window.id, window.scope, window.usedPercent]),
      [
        ["seven_day", null, 16],
        ["codex_spark:five_hour", "GPT-5.3-Codex-Spark", 3],
        ["codex_spark:seven_day", "GPT-5.3-Codex-Spark", 1],
      ],
    );
  });

  it("reports nothing for a snapshot without windows", () => {
    assert.strictEqual(parseCodexRateLimits({ planType: "pro" }, OBSERVED_AT), null);
    assert.strictEqual(parseCodexRateLimits("nonsense", OBSERVED_AT), null);
  });
});

describe("parseClaudeRateLimitEvent", () => {
  it("reads every window when the CLI attaches the per-window breakdown", () => {
    const limits = parseClaudeRateLimitEvent(
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "five_hour",
          utilization: 0.2,
          resetsAt: 1_786_200_000,
          unifiedWindows: {
            five_hour: { utilization: 0.2, resetsAt: 1_786_200_000 },
            seven_day: { utilization: 0.615, resetsAt: 1_786_500_000 },
            seven_day_overage_included: null,
          },
        },
      },
      OBSERVED_AT,
    );

    assert.deepStrictEqual(
      limits?.windows.map((window) => [window.id, window.usedPercent, window.resetsAt]),
      [
        ["five_hour", 20, "2026-08-08T14:40:00.000Z"],
        ["seven_day", 61.5, "2026-08-12T02:00:00.000Z"],
      ],
    );
  });

  it("falls back to the one representative window older CLIs report", () => {
    const limits = parseClaudeRateLimitEvent(
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          rateLimitType: "seven_day",
          utilization: 0.81,
          resetsAt: 1_786_500_000,
        },
      },
      OBSERVED_AT,
    );

    assert.deepStrictEqual(limits, {
      provider: "claude",
      plan: null,
      windows: [
        {
          id: "seven_day",
          scope: null,
          durationMinutes: 10_080,
          usedPercent: 81,
          resetsAt: "2026-08-12T02:00:00.000Z",
          observedAt: OBSERVED_AT,
        },
      ],
    });
  });

  it("ignores overage and events without a utilization figure", () => {
    assert.strictEqual(
      parseClaudeRateLimitEvent(
        { rate_limit_info: { status: "allowed", rateLimitType: "overage", utilization: 0.03 } },
        OBSERVED_AT,
      ),
      null,
    );
    assert.strictEqual(
      parseClaudeRateLimitEvent(
        { rate_limit_info: { status: "allowed", rateLimitType: "five_hour" } },
        OBSERVED_AT,
      ),
      null,
    );
  });
});

describe("limitsFromRuntimeEvent", () => {
  it("unwraps the Codex notification envelope", () => {
    const limits = limitsFromRuntimeEvent(
      rateLimitEvent("codex", {
        rateLimits: { primary: { usedPercent: 7, windowDurationMins: 300 } },
      }),
    );
    assert.strictEqual(limits?.provider, "codex");
    assert.strictEqual(limits?.windows[0]?.usedPercent, 7);
  });

  it("routes Claude events by driver kind and ignores other drivers", () => {
    const claude = limitsFromRuntimeEvent(
      rateLimitEvent("claudeAgent", {
        rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.12 },
      }),
    );
    assert.strictEqual(claude?.provider, "claude");
    assert.strictEqual(claude?.windows[0]?.usedPercent, 12);
    assert.strictEqual(
      limitsFromRuntimeEvent(
        rateLimitEvent("opencode", {
          rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.12 },
        }),
      ),
      null,
    );
  });
});

describe("mergeProviderLimits", () => {
  it("keeps windows the update did not mention and orders by length", () => {
    const merged = mergeProviderLimits(
      {
        provider: "claude",
        plan: null,
        windows: [
          {
            id: "seven_day",
            scope: null,
            durationMinutes: 10_080,
            usedPercent: 60,
            resetsAt: null,
            observedAt: OBSERVED_AT,
          },
        ],
      },
      {
        provider: "claude",
        plan: null,
        windows: [
          {
            id: "five_hour",
            scope: null,
            durationMinutes: 300,
            usedPercent: 20,
            resetsAt: null,
            observedAt: LATER,
          },
        ],
      },
    );

    assert.deepStrictEqual(
      merged.windows.map((window) => [window.id, window.usedPercent]),
      [
        ["five_hour", 20],
        ["seven_day", 60],
      ],
    );
  });

  it("never replaces a reading with an older one", () => {
    const merged = mergeProviderLimits(
      {
        provider: "codex",
        plan: "Pro",
        windows: [
          {
            id: "five_hour",
            scope: null,
            durationMinutes: 300,
            usedPercent: 50,
            resetsAt: null,
            observedAt: LATER,
          },
        ],
      },
      {
        provider: "codex",
        plan: null,
        windows: [
          {
            id: "five_hour",
            scope: null,
            durationMinutes: 300,
            usedPercent: 10,
            resetsAt: null,
            observedAt: OBSERVED_AT,
          },
        ],
      },
    );

    assert.strictEqual(merged.windows[0]?.usedPercent, 50);
    assert.strictEqual(merged.plan, "Pro");
  });
});

describe("resolveCodexRefreshSettings", () => {
  it.live("prefers an explicit Codex instance over the legacy provider block", () =>
    Effect.gen(function* () {
      const settingsService = yield* ServerSettings.ServerSettingsService.pipe(
        Effect.provide(
          ServerSettings.layerTest({
            providers: { codex: { binaryPath: "legacy-codex" } },
            providerInstances: {
              [ProviderInstanceId.make("codex")]: {
                driver: ProviderDriverKind.make("codex"),
                config: { binaryPath: "instance-codex" },
              },
            },
          }).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      );
      const settings = yield* settingsService.getSettings;
      assert.strictEqual(resolveCodexRefreshSettings(settings).binaryPath, "instance-codex");
    }).pipe(Effect.scoped),
  );

  it.live("falls back to the legacy provider block without an explicit instance", () =>
    Effect.gen(function* () {
      const settingsService = yield* ServerSettings.ServerSettingsService.pipe(
        Effect.provide(
          ServerSettings.layerTest({ providers: { codex: { binaryPath: "legacy-codex" } } }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      );
      const settings = yield* settingsService.getSettings;
      assert.strictEqual(resolveCodexRefreshSettings(settings).binaryPath, "legacy-codex");
    }).pipe(Effect.scoped),
  );
});

describe("UsageLimitsStore", () => {
  const storeLayers = (prefix: string) =>
    ServerConfig.layerTest(process.cwd(), { prefix }).pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(ServerSettings.layerTest({ providers: { codex: { enabled: false } } })),
    );

  it.live("persists readings so a restarted store starts from the last figure", () =>
    Effect.gen(function* () {
      // Built once: each build of the config layer is a fresh temp directory.
      const services = yield* Layer.build(storeLayers("usage-limits-test"));
      const first = yield* make.pipe(Effect.provide(services));
      const config = yield* ServerConfig.ServerConfig.pipe(Effect.provide(services));
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(config.stateDir, { recursive: true, force: true })),
      );

      yield* first.record({
        provider: "claude",
        plan: null,
        windows: [
          {
            id: "five_hour",
            scope: null,
            durationMinutes: 300,
            usedPercent: 33,
            resetsAt: null,
            observedAt: OBSERVED_AT,
          },
        ],
      });

      const second = yield* make.pipe(Effect.provide(services));
      const limits = yield* second.read;
      assert.strictEqual(limits.length, 1);
      assert.strictEqual(limits[0]?.windows[0]?.usedPercent, 33);
    }).pipe(Effect.scoped),
  );

  it.live("refresh leaves the store untouched while Codex is disabled", () =>
    Effect.gen(function* () {
      const services = yield* Layer.build(storeLayers("usage-limits-disabled-test"));
      const store = yield* make.pipe(Effect.provide(services));
      const config = yield* ServerConfig.ServerConfig.pipe(Effect.provide(services));
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(config.stateDir, { recursive: true, force: true })),
      );

      yield* store.refresh;
      assert.deepStrictEqual(yield* store.read, []);
    }).pipe(Effect.scoped),
  );
});
