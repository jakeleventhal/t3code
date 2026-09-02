// @effect-diagnostics globalDate:off -- Usage windows are calendar days in the viewer's zone, derived from wall-clock "now" via Intl.
/**
 * Display formatting for the usage page.
 *
 * @module usageFormat
 */
import { UsageDay, type UsageResolution, type UsageSummaryInput } from "@t3tools/contracts";

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("en-US");

export function formatUsd(value: number): string {
  return CURRENCY.format(value);
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.round(value));
}

/**
 * Compacts a token count to three significant figures with a unit suffix, so
 * columns of numbers line up at a glance (`19.9B`, `76.7M`, `804K`).
 */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trim(value / 1e12)}T`;
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;
  return INTEGER.format(Math.round(value));
}

function trim(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/** `2026-08-07` to `Aug 7`. */
export function formatDayShort(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map((part) => Number(part));
  if (year === undefined || month === undefined || dayOfMonth === undefined) return day;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MONTHS[month - 1] ?? ""} ${dayOfMonth}`;
}

/** Inclusive day list between two `YYYY-MM-DD` bounds. */
export function enumerateDays(sinceDay: string, untilDay: string): readonly string[] {
  const days: string[] = [];
  const start = Date.parse(`${sinceDay}T00:00:00Z`);
  const end = Date.parse(`${untilDay}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return days;

  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

const HOUR_MS = 60 * 60 * 1000;

/** Every fixed-duration bucket start in an hourly rolling window. */
export function enumerateHourStarts(sinceTime: string, untilTime: string): readonly string[] {
  const starts: string[] = [];
  const start = Date.parse(sinceTime);
  const end = Date.parse(untilTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return starts;

  for (let cursor = start; cursor < end; cursor += HOUR_MS) {
    starts.push(new Date(cursor).toISOString());
  }
  return starts;
}

/**
 * A rolling bucket start rendered in the viewer's requested time zone.
 *
 * Repeated wall-clock hours during a fall-back transition include their short
 * zone name so the two distinct buckets remain distinguishable.
 */
export function formatHourShort(hourStart: string, timeZone?: string): string {
  const instant = new Date(hourStart);
  if (Number.isNaN(instant.getTime())) return hourStart;
  const options = timeZone === undefined ? {} : { timeZone };
  const hourFormat = new Intl.DateTimeFormat("en-US", {
    ...options,
    hour: "numeric",
  });
  const wallHourFormat = new Intl.DateTimeFormat("en-CA", {
    ...options,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const wallHour = wallHourFormat.format(instant);
  const isRepeatedHour = [-HOUR_MS, HOUR_MS].some(
    (offset) => wallHourFormat.format(new Date(instant.getTime() + offset)) === wallHour,
  );

  if (!isRepeatedHour) return hourFormat.format(instant);
  return new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
    hour: "numeric",
    timeZoneName: "short",
  }).format(instant);
}

/** `2026-08-11T14:37:00Z` to `Aug 11, 2 PM` in the requested zone. */
export function formatDateTimeShort(instant: string, timeZone?: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(date);
}

/** An hourly tooltip label relative to the rolling window's end date. */
export function formatRelativeHourShort(
  hourStart: string,
  relativeTo: string,
  timeZone?: string,
): string {
  const instant = new Date(hourStart);
  const reference = new Date(relativeTo);
  if (Number.isNaN(instant.getTime()) || Number.isNaN(reference.getTime())) {
    return formatDateTimeShort(hourStart, timeZone);
  }

  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const instantDay = Date.parse(`${dayFormat.format(instant)}T00:00:00Z`);
  const referenceDay = Date.parse(`${dayFormat.format(reference)}T00:00:00Z`);
  const calendarDaysAgo = Math.round((referenceDay - instantDay) / (24 * HOUR_MS));
  const hour = formatHourShort(hourStart, timeZone);

  if (calendarDaysAgo === 0) return `${hour} today`;
  if (calendarDaysAgo === 1) return `${hour} yesterday`;
  return formatDateTimeShort(hourStart, timeZone);
}

/**
 * The window the page requests, expressed in the viewer's own time zone so days
 * line up with what they actually experienced.
 */
export function makeWindow(
  days: number,
  now = new Date(),
  resolution: UsageResolution = "day",
): UsageSummaryInput {
  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // An unknown zone should degrade to UTC rather than crash the page.
    timeZone = "UTC";
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const untilDay = format.format(now);
  if (resolution === "hour") {
    // Minute-aligned bounds keep labels readable while still representing an
    // exact rolling 24-hour duration. Fixed-duration buckets remain correct
    // across offset changes and daylight-saving transitions.
    const untilTimeMs = Math.floor(now.getTime() / 60_000) * 60_000;
    const sinceTimeMs = untilTimeMs - 24 * HOUR_MS;
    const sinceTime = new Date(sinceTimeMs);
    const untilTime = new Date(untilTimeMs);
    return {
      sinceDay: UsageDay.make(format.format(sinceTime)),
      untilDay: UsageDay.make(format.format(untilTime)),
      timeZone,
      resolution,
      sinceTime: sinceTime.toISOString(),
      untilTime: untilTime.toISOString(),
    };
  }
  // Subtracting fixed milliseconds from `now` lands on the wrong calendar day
  // around a DST transition. The window start is pure calendar arithmetic on
  // the local end day, done in UTC where days are uniform.
  const [year = 0, month = 1, dayOfMonth = 1] = untilDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth - (days - 1)));
  return {
    sinceDay: UsageDay.make(start.toISOString().slice(0, 10)),
    untilDay: UsageDay.make(untilDay),
    timeZone,
    resolution,
  };
}

const LIMIT_WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "Weekly limit",
  seven_day_opus: "Weekly Opus limit",
  seven_day_sonnet: "Weekly Sonnet limit",
  seven_day_overage_included: "Weekly limit incl. overage",
};

/**
 * `five_hour` to `5-hour limit`; a window with no known name is labelled by
 * its length, and a separately metered bucket carries its name in front.
 */
export function formatLimitWindowLabel(window: {
  readonly id: string;
  readonly scope?: string | null;
  readonly durationMinutes: number | null;
}): string {
  const base = window.id.includes(":")
    ? window.id.slice(window.id.lastIndexOf(":") + 1)
    : window.id;
  const label = LIMIT_WINDOW_LABELS[base] ?? labelByDuration(window.durationMinutes);
  return window.scope ? `${window.scope} · ${label}` : label;
}

function labelByDuration(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "Usage limit";
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 7 ? "Weekly limit" : `${days}-day limit`;
  }
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

/**
 * When a window resets, relative to `now` while it is less than a day out and
 * as a weekday and hour beyond that. Null when the provider gave no reset.
 */
export function formatLimitReset(
  resetsAt: string | null,
  now: Date,
  timeZone?: string,
): string | null {
  if (resetsAt === null) return null;
  const instant = new Date(resetsAt);
  if (Number.isNaN(instant.getTime())) return null;
  const remainingMs = instant.getTime() - now.getTime();
  if (remainingMs <= 0) return "Resets now";
  if (remainingMs < 24 * HOUR_MS) {
    const totalMinutes = Math.ceil(remainingMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `Resets in ${minutes}m`;
    return minutes === 0 ? `Resets in ${hours}h` : `Resets in ${hours}h ${minutes}m`;
  }
  const label = new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
    weekday: "short",
    hour: "numeric",
  }).format(instant);
  return `Resets ${label}`;
}

/**
 * The most recently observed window's instant, compared as time rather than
 * text so readings with different offsets or precision still order correctly.
 */
export function latestObservedAt(
  windows: readonly { readonly observedAt: string }[],
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    const ms = Date.parse(window.observedAt);
    if (Number.isNaN(ms) || ms <= latestMs) continue;
    latest = window.observedAt;
    latestMs = ms;
  }
  return latest;
}

/** How old a reading is: `just now`, `5m ago`, `3h ago`, `2d ago`. */
export function formatObservedAgo(observedAt: string, now: Date): string {
  const instant = new Date(observedAt);
  if (Number.isNaN(instant.getTime())) return "";
  const elapsedMs = Math.max(0, now.getTime() - instant.getTime());
  if (elapsedMs < 60_000) return "just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
