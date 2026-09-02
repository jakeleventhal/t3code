// @effect-diagnostics globalDate:off -- A fixed instant keeps calendar-window assertions deterministic.
import { describe, expect, it, vi } from "vite-plus/test";

import {
  enumerateHourStarts,
  formatDateTimeShort,
  formatHourShort,
  formatLimitReset,
  formatLimitWindowLabel,
  formatObservedAgo,
  formatRelativeHourShort,
  makeWindow,
} from "./usageFormat.ts";

describe("hourly usage formatting", () => {
  it("enumerates 24 fixed buckets across a rolling window", () => {
    const hours = enumerateHourStarts("2026-08-10T12:37:00.000Z", "2026-08-11T12:37:00.000Z");

    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe("2026-08-10T12:37:00.000Z");
    expect(hours[23]).toBe("2026-08-11T11:37:00.000Z");
  });

  it("formats rolling instants in the requested time zone", () => {
    expect(formatHourShort("2026-08-11T00:37:00.000Z", "UTC")).toBe("12 AM");
    expect(formatHourShort("2026-08-11T12:37:00.000Z", "UTC")).toBe("12 PM");
    expect(formatDateTimeShort("2026-08-11T17:37:00.000Z", "UTC")).toBe("Aug 11, 5 PM");
  });

  it("disambiguates repeated hours during a fall-back transition", () => {
    expect(formatHourShort("2026-11-01T05:37:00.000Z", "America/New_York")).toBe("1 AM EDT");
    expect(formatHourShort("2026-11-01T06:37:00.000Z", "America/New_York")).toBe("1 AM EST");
  });

  it("makes hourly tooltip dates relative to the window in its requested time zone", () => {
    const windowEnd = "2026-08-11T14:37:00.000Z";

    expect(formatRelativeHourShort("2026-08-10T17:37:00.000Z", windowEnd, "UTC")).toBe(
      "5 PM yesterday",
    );
    expect(formatRelativeHourShort("2026-08-11T14:37:00.000Z", windowEnd, "UTC")).toBe(
      "2 PM today",
    );
    expect(
      formatRelativeHourShort(
        "2026-08-11T01:37:00.000Z",
        "2026-08-11T10:37:00.000Z",
        "America/Los_Angeles",
      ),
    ).toBe("6 PM yesterday");
  });

  it("builds an exact minute-aligned 24-hour request", () => {
    const window = makeWindow(1, new Date("2026-08-11T12:37:42.123Z"), "hour");

    expect(window.resolution).toBe("hour");
    expect(window.sinceTime).toBe("2026-08-10T12:37:00.000Z");
    expect(window.untilTime).toBe("2026-08-11T12:37:00.000Z");
  });

  it("degrades an unknown resolved zone to UTC instead of crashing", () => {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    const resolvedOptions = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ ...resolved, timeZone: "Etc/Unknown" });

    try {
      const now = new Date("2026-08-11T12:37:42.123Z");

      expect(makeWindow(1, now, "hour").timeZone).toBe("UTC");
      expect(makeWindow(30, now).timeZone).toBe("UTC");
    } finally {
      resolvedOptions.mockRestore();
    }
  });
});

describe("limit formatting", () => {
  it("labels known windows by name and unknown ones by length", () => {
    expect(formatLimitWindowLabel({ id: "five_hour", durationMinutes: 300 })).toBe("5-hour limit");
    expect(formatLimitWindowLabel({ id: "seven_day_opus", durationMinutes: 10_080 })).toBe(
      "Weekly Opus limit",
    );
    expect(formatLimitWindowLabel({ id: "primary", durationMinutes: 10_080 })).toBe("Weekly limit");
    expect(formatLimitWindowLabel({ id: "primary", durationMinutes: 180 })).toBe("3-hour limit");
    expect(formatLimitWindowLabel({ id: "primary", durationMinutes: 2880 })).toBe("2-day limit");
    expect(formatLimitWindowLabel({ id: "primary", durationMinutes: null })).toBe("Usage limit");
    expect(
      formatLimitWindowLabel({ id: "codex_spark:five_hour", scope: "Spark", durationMinutes: 300 }),
    ).toBe("Spark · 5-hour limit");
  });

  it("describes a reset as a countdown inside a day and a weekday beyond it", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");

    expect(formatLimitReset("2026-08-11T14:10:00.000Z", now)).toBe("Resets in 2h 10m");
    expect(formatLimitReset("2026-08-11T12:00:30.000Z", now)).toBe("Resets in 1m");
    expect(formatLimitReset("2026-08-11T15:00:00.000Z", now)).toBe("Resets in 3h");
    expect(formatLimitReset("2026-08-11T11:00:00.000Z", now)).toBe("Resets now");
    expect(formatLimitReset("2026-08-14T15:00:00.000Z", now, "UTC")).toBe("Resets Fri 3 PM");
    expect(formatLimitReset(null, now)).toBeNull();
    expect(formatLimitReset("not a date", now)).toBeNull();
  });

  it("describes how old a reading is", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");

    expect(formatObservedAgo("2026-08-11T11:59:30.000Z", now)).toBe("just now");
    expect(formatObservedAgo("2026-08-11T11:35:00.000Z", now)).toBe("25m ago");
    expect(formatObservedAgo("2026-08-11T08:00:00.000Z", now)).toBe("4h ago");
    expect(formatObservedAgo("2026-08-08T08:00:00.000Z", now)).toBe("3d ago");
  });
});
