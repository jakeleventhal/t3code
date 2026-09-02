/**
 * Subscription limits per provider, as the provider CLIs report them.
 *
 * Codex answers `account/rateLimits/read` on demand and pushes
 * `account/rateLimits/updated` during turns. Claude Code only pushes a
 * `rate_limit_event` inside a running turn, carrying the single window closest
 * to exhaustion. Both reach the store as `account.rate-limits.updated` runtime
 * events; the latest figure per window is kept and persisted so the usage page
 * has something to show before the next turn runs.
 *
 * @module usageLimits
 */
import {
  CodexSettings,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderRuntimeAccountRateLimitsUpdatedEvent,
  type ServerSettings as ServerSettingsSnapshot,
  type UsageLimitWindow,
  type UsageProviderKind,
  UsageProviderLimits,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { ServerConfig } from "../config.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { readCodexRateLimits } from "../provider/Layers/CodexProvider.ts";
import { resolveCodexLaunchArgs } from "../provider/Layers/codexLaunchArgs.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

/** A cold app-server handshake is well under a second; anything longer is a stuck CLI. */
const CODEX_READ_TIMEOUT = Duration.seconds(8);

const FIVE_HOURS_MINUTES = 5 * 60;
const SEVEN_DAYS_MINUTES = 7 * 24 * 60;

const OptionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Number));
const OptionalString = Schema.optionalKey(Schema.NullOr(Schema.String));

/** The subset of Codex's `RateLimitSnapshot` the page shows. */
const CodexRateLimitWindow = Schema.Struct({
  usedPercent: Schema.Number,
  windowDurationMins: OptionalNumber,
  resetsAt: OptionalNumber,
});
const CodexRateLimitSnapshot = Schema.Struct({
  limitId: OptionalString,
  limitName: OptionalString,
  planType: OptionalString,
  primary: Schema.optionalKey(Schema.NullOr(CodexRateLimitWindow)),
  secondary: Schema.optionalKey(Schema.NullOr(CodexRateLimitWindow)),
});
type CodexRateLimitSnapshot = typeof CodexRateLimitSnapshot.Type;
const decodeCodexSnapshot = Schema.decodeUnknownOption(CodexRateLimitSnapshot);
/** `account/rateLimits/read`: the plan's bucket plus any separately metered ones. */
const CodexRateLimitsRead = Schema.Struct({
  rateLimits: CodexRateLimitSnapshot,
  rateLimitsByLimitId: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, CodexRateLimitSnapshot)),
  ),
});
const decodeCodexRead = Schema.decodeUnknownOption(CodexRateLimitsRead);

/** Codex's default bucket; other ids are separately metered model families. */
const CODEX_MAIN_LIMIT_ID = "codex";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);

/**
 * The Codex configuration the runtime actually launches: an explicit
 * `providerInstances` entry for the default Codex slot wins over the legacy
 * `providers.codex` mirror, matching `deriveProviderInstanceConfigMap`.
 */
export function resolveCodexRefreshSettings(settings: ServerSettingsSnapshot): CodexSettings {
  const instance = settings.providerInstances[defaultInstanceIdForDriver(CODEX_DRIVER)];
  if (instance !== undefined && instance.driver === CODEX_DRIVER) {
    const decoded = decodeCodexSettings(instance.config ?? {});
    if (decoded._tag === "Some") {
      return instance.enabled === false ? { ...decoded.value, enabled: false } : decoded.value;
    }
  }
  return settings.providers.codex;
}

/**
 * The subset of the Claude Agent SDK's `rate_limit_event` the page shows.
 *
 * `utilization` is a 0-1 fraction and `resetsAt` unix seconds. Recent CLIs
 * also attach `unifiedWindows`, every window at once; older ones only carry
 * the single representative window at the top level.
 */
const ClaudeRateLimitWindow = Schema.Struct({
  utilization: Schema.Number,
  resetsAt: OptionalNumber,
});
const ClaudeRateLimitEvent = Schema.Struct({
  rate_limit_info: Schema.Struct({
    rateLimitType: OptionalString,
    utilization: OptionalNumber,
    resetsAt: OptionalNumber,
    unifiedWindows: Schema.optionalKey(
      Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(ClaudeRateLimitWindow))),
    ),
  }),
});
const decodeClaudeEvent = Schema.decodeUnknownOption(ClaudeRateLimitEvent);

const CODEX_PLAN_LABELS: Record<string, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro 5x",
  team: "Team",
  self_serve_business_prolite: "Business",
  self_serve_business_usage_based: "Business",
  business: "Business",
  ent26: "Enterprise",
  enterprise_cbp_automation: "Enterprise",
  enterprise_cbp_usage_based: "Enterprise",
  enterprise: "Enterprise",
  edu: "Edu",
  edu_plus: "Edu",
  edu_pro: "Edu",
};

/** Providers with a `rate_limit`-shaped payload, keyed by driver kind. */
const PROVIDER_BY_DRIVER: Partial<Record<string, UsageProviderKind>> = {
  codex: "codex",
  claudeAgent: "claude",
};

function isoFromUnixSeconds(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return DateTime.formatIso(DateTime.makeUnsafe(seconds * 1000));
}

/**
 * Codex's primary/secondary windows have no name of their own, so they are
 * mapped onto Claude's ids by duration and both providers label alike.
 */
function codexWindowId(key: "primary" | "secondary", durationMinutes: number | null): string {
  if (durationMinutes === FIVE_HOURS_MINUTES) return "five_hour";
  if (durationMinutes === SEVEN_DAYS_MINUTES) return "seven_day";
  return key;
}

/**
 * One snapshot's windows. A separately metered bucket keeps its id in the
 * window id so a rolling update for it replaces its own windows, not the
 * plan's.
 */
function codexSnapshotWindows(
  snapshot: CodexRateLimitSnapshot,
  observedAt: string,
): UsageLimitWindow[] {
  const limitId = snapshot.limitId ?? CODEX_MAIN_LIMIT_ID;
  const isMain = limitId === CODEX_MAIN_LIMIT_ID;
  const scope = isMain ? null : (snapshot.limitName ?? limitId);
  const windows: UsageLimitWindow[] = [];
  for (const key of ["primary", "secondary"] as const) {
    const window = snapshot[key];
    if (!window) continue;
    const durationMinutes =
      window.windowDurationMins === null || window.windowDurationMins === undefined
        ? null
        : Math.max(0, Math.round(window.windowDurationMins));
    const base = codexWindowId(key, durationMinutes);
    windows.push({
      id: isMain ? base : `${limitId}:${base}`,
      scope,
      durationMinutes,
      usedPercent: window.usedPercent,
      resetsAt: isoFromUnixSeconds(window.resetsAt),
      observedAt,
    });
  }
  return windows;
}

function codexLimits(
  planType: string | null | undefined,
  windows: UsageLimitWindow[],
): UsageProviderLimits | null {
  if (windows.length === 0) return null;
  return {
    provider: "codex",
    plan: planType ? (CODEX_PLAN_LABELS[planType] ?? null) : null,
    windows,
  };
}

/** Reads one `RateLimitSnapshot`, the shape `account/rateLimits/updated` pushes. */
export function parseCodexRateLimits(
  snapshot: unknown,
  observedAt: string,
): UsageProviderLimits | null {
  const decoded = decodeCodexSnapshot(snapshot);
  if (decoded._tag === "None") return null;
  return codexLimits(decoded.value.planType, codexSnapshotWindows(decoded.value, observedAt));
}

/** Reads an `account/rateLimits/read` response, including separately metered buckets. */
export function parseCodexRateLimitsRead(
  response: unknown,
  observedAt: string,
): UsageProviderLimits | null {
  const decoded = decodeCodexRead(response);
  if (decoded._tag === "None") return null;
  const main = decoded.value.rateLimits;
  const windows = codexSnapshotWindows(main, observedAt);
  const mainId = main.limitId ?? CODEX_MAIN_LIMIT_ID;
  for (const [limitId, snapshot] of Object.entries(decoded.value.rateLimitsByLimitId ?? {})) {
    if (limitId === mainId) continue;
    windows.push(...codexSnapshotWindows({ ...snapshot, limitId }, observedAt));
  }
  return codexLimits(main.planType, windows);
}

/** Overage is a billing mode, not a rolling window; anything else is 5h or 7d. */
function claudeWindowDuration(id: string): number | null {
  if (id === "five_hour") return FIVE_HOURS_MINUTES;
  if (id.startsWith("seven_day")) return SEVEN_DAYS_MINUTES;
  return null;
}

/**
 * Reads one Claude Agent SDK `rate_limit_event`. With `unifiedWindows` the
 * event yields every window; without it only the representative one, and the
 * store merges successive events into the full picture.
 */
export function parseClaudeRateLimitEvent(
  message: unknown,
  observedAt: string,
): UsageProviderLimits | null {
  const decoded = decodeClaudeEvent(message);
  if (decoded._tag === "None") return null;
  const info = decoded.value.rate_limit_info;
  const windows: UsageLimitWindow[] = [];
  const push = (id: string, utilization: number, resetsAt: number | null | undefined) => {
    const durationMinutes = claudeWindowDuration(id);
    if (durationMinutes === null || !Number.isFinite(utilization)) return;
    windows.push({
      id,
      scope: null,
      durationMinutes,
      usedPercent: utilization * 100,
      resetsAt: isoFromUnixSeconds(resetsAt),
      observedAt,
    });
  };
  for (const [id, window] of Object.entries(info.unifiedWindows ?? {})) {
    if (window) push(id, window.utilization, window.resetsAt);
  }
  if (
    windows.length === 0 &&
    info.rateLimitType &&
    info.utilization !== null &&
    info.utilization !== undefined
  ) {
    push(info.rateLimitType, info.utilization, info.resetsAt);
  }
  if (windows.length === 0) return null;
  return { provider: "claude", plan: null, windows };
}

/** Translates a runtime event from either adapter into limits, or null when it carries none. */
export function limitsFromRuntimeEvent(
  event: ProviderRuntimeAccountRateLimitsUpdatedEvent,
): UsageProviderLimits | null {
  const provider = PROVIDER_BY_DRIVER[event.provider];
  if (provider === "codex") {
    const payload = event.payload.rateLimits;
    const snapshot =
      typeof payload === "object" && payload !== null && "rateLimits" in payload
        ? payload.rateLimits
        : payload;
    return parseCodexRateLimits(snapshot, event.createdAt);
  }
  if (provider === "claude") {
    return parseClaudeRateLimitEvent(event.payload.rateLimits, event.createdAt);
  }
  return null;
}

/** Unparseable instants sort oldest so a well-formed reading always replaces them. */
function observedAtMs(window: UsageLimitWindow): number {
  const ms = Date.parse(window.observedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Folds a new observation into what is already known for the provider. Each
 * window is replaced by its newer reading; windows the update did not mention
 * are kept, which is what turns Claude's one-window events into a full set.
 */
export function mergeProviderLimits(
  previous: UsageProviderLimits | undefined,
  next: UsageProviderLimits,
): UsageProviderLimits {
  const byId = new Map<string, UsageLimitWindow>();
  for (const window of previous?.windows ?? []) byId.set(window.id, window);
  for (const window of next.windows) {
    const existing = byId.get(window.id);
    if (existing === undefined || observedAtMs(existing) <= observedAtMs(window)) {
      byId.set(window.id, window);
    }
  }
  // The plan's own windows first, then each named bucket, shortest window first.
  const windows = [...byId.values()].sort(
    (left, right) =>
      (left.scope ?? "").localeCompare(right.scope ?? "") ||
      (left.durationMinutes ?? Number.MAX_SAFE_INTEGER) -
        (right.durationMinutes ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
  return { provider: next.provider, plan: next.plan ?? previous?.plan ?? null, windows };
}

function sameWindow(left: UsageLimitWindow, right: UsageLimitWindow): boolean {
  return (
    left.id === right.id &&
    left.scope === right.scope &&
    left.durationMinutes === right.durationMinutes &&
    left.usedPercent === right.usedPercent &&
    left.resetsAt === right.resetsAt &&
    left.observedAt === right.observedAt
  );
}

function sameLimits(left: UsageProviderLimits, right: UsageProviderLimits): boolean {
  return (
    left.plan === right.plan &&
    left.windows.length === right.windows.length &&
    left.windows.every((window, index) => {
      const other = right.windows[index];
      return other !== undefined && sameWindow(window, other);
    })
  );
}

export class UsageLimitsStore extends Context.Service<
  UsageLimitsStore,
  {
    /** Folds one observation into the store. */
    readonly record: (limits: UsageProviderLimits) => Effect.Effect<void>;
    /**
     * Asks providers that can answer on demand (Codex) for a live reading.
     * Never fails: a provider that cannot answer leaves its last reading in
     * place.
     */
    readonly refresh: Effect.Effect<void>;
    readonly read: Effect.Effect<readonly UsageProviderLimits[]>;
  }
>()("t3/usage/usageLimits/UsageLimitsStore") {}

/** Empty, inert store for suites that only need the usage surface to resolve. */
export const layerTest = Layer.succeed(
  UsageLimitsStore,
  UsageLimitsStore.of({
    record: () => Effect.void,
    refresh: Effect.void,
    read: Effect.succeed([]),
  }),
);

const LimitsFile = Schema.Struct({ limits: Schema.Array(UsageProviderLimits) });
const LimitsFileJson = Schema.fromJsonString(
  LimitsFile as unknown as Schema.Codec<typeof LimitsFile.Type>,
);
const decodeLimitsFile = Schema.decodeUnknownEffect(LimitsFileJson);
const encodeLimitsFile = Schema.encodeEffect(LimitsFileJson);

/** The in-memory fold and its on-disk mirror; the provider subscription is wired separately. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const filePath = path.join(config.stateDir, "usage-limits.json");
  const byProvider = new Map<UsageProviderKind, UsageProviderLimits>();
  // The event subscription and a page-load refresh can record at the same
  // time; one permit keeps each fold and its write in order so the file never
  // ends up holding an older snapshot than memory.
  const recordSemaphore = yield* Semaphore.make(1);

  const loaded = yield* fileSystem.readFileString(filePath).pipe(
    Effect.flatMap((raw) => decodeLimitsFile(raw)),
    Effect.catchCause(() => Effect.succeed(null)),
  );
  for (const limits of loaded?.limits ?? []) byProvider.set(limits.provider, limits);

  const persist = Effect.suspend(() => encodeLimitsFile({ limits: [...byProvider.values()] })).pipe(
    Effect.flatMap((serialized) => fileSystem.writeFileString(filePath, serialized)),
    // A file we cannot write is a blank page after the next restart, not a failed turn.
    Effect.catchCause(() => Effect.void),
  );

  const record: UsageLimitsStore["Service"]["record"] = (limits) =>
    recordSemaphore.withPermits(1)(
      Effect.suspend(() => {
        const previous = byProvider.get(limits.provider);
        const merged = mergeProviderLimits(previous, limits);
        // Claude repeats the same reading on every request inside a turn; only
        // a changed figure is worth a write.
        if (previous !== undefined && sameLimits(previous, merged)) return Effect.void;
        byProvider.set(limits.provider, merged);
        return persist;
      }),
    );

  const refresh: UsageLimitsStore["Service"]["refresh"] = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (settings === null) return;
    const codex = resolveCodexRefreshSettings(settings);
    if (!codex.enabled) return;
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const response = yield* readCodexRateLimits({
      binaryPath: codex.binaryPath,
      homePath: codex.homePath,
      launchArgs: resolveCodexLaunchArgs(codex.launchArgs, process.env),
      cwd: process.cwd(),
      environment: process.env,
    }).pipe(
      Effect.scoped,
      Effect.timeout(CODEX_READ_TIMEOUT),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      // A missing or signed-out CLI is a normal state, not a failed page.
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (response === null) return;
    const limits = parseCodexRateLimitsRead(response, observedAt);
    if (limits !== null) yield* record(limits);
  });

  const read: UsageLimitsStore["Service"]["read"] = Effect.sync(() => [...byProvider.values()]);

  return UsageLimitsStore.of({ record, refresh, read });
});

/** Production store: persisted, fed by every adapter's rate-limit events. */
export const layer = Layer.effect(
  UsageLimitsStore,
  Effect.gen(function* () {
    const store = yield* make;
    const providerService = yield* ProviderService;
    yield* forkParked(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "account.rate-limits.updated") return Effect.void;
        const limits = limitsFromRuntimeEvent(event);
        return limits === null ? Effect.void : store.record(limits);
      }),
    );
    return store;
  }),
);
