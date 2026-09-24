import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { PreviewAutomationHost, PreviewAutomationStatus } from "./previewAutomation.ts";

const decodeAutomationHost = Schema.decodeUnknownSync(PreviewAutomationHost);
const decodeAutomationStatus = Schema.decodeUnknownSync(PreviewAutomationStatus);

describe("PreviewAutomationHost", () => {
  it("accepts legacy hosts and current operation advertisements", () => {
    expect(decodeAutomationHost({ clientId: "legacy", environmentId: "environment-1" })).toEqual({
      clientId: "legacy",
      environmentId: "environment-1",
    });
    expect(
      decodeAutomationHost({
        clientId: "current",
        environmentId: "environment-1",
        supportedOperations: ["status", "resize"],
      }).supportedOperations,
    ).toEqual(["status", "resize"]);
  });
});

describe("PreviewAutomationStatus", () => {
  it("accepts old hosts without viewport data and exposes it from current hosts", () => {
    const base = {
      available: true,
      visible: false,
      tabId: "preview-t",
      url: "https://example.com",
      title: "Example",
      loading: false,
    };
    expect(decodeAutomationStatus(base)).toEqual(base);
    expect(
      decodeAutomationStatus({
        ...base,
        viewportSetting: { _tag: "preset", presetId: "pixel-8", width: 412, height: 915 },
        viewport: { width: 412, height: 915 },
      }).viewport,
    ).toEqual({ width: 412, height: 915 });
  });
});

describe("ConfiguredLocalServerUrls", () => {
  it("bounds the number and length of probe candidates", () => {
    expect(() =>
      decodeConfiguredLocalServerUrls(
        Array.from(
          { length: CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS + 1 },
          (_, index) => `http://localhost:${3_000 + index}`,
        ),
      ),
    ).toThrow();
    expect(() =>
      decodeConfiguredLocalServerUrls([`http://localhost/${"a".repeat(PREVIEW_URL_MAX_LENGTH)}`]),
    ).toThrow();
  });
});
