import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { DiscoveredLocalServer } from "./preview.ts";
import { PreviewAutomationHost, PreviewAutomationStatus } from "./previewAutomation.ts";

const decodeAutomationHost = Schema.decodeUnknownSync(PreviewAutomationHost);
const decodeAutomationStatus = Schema.decodeUnknownSync(PreviewAutomationStatus);
const decodeDiscoveredLocalServer = Schema.decodeUnknownSync(DiscoveredLocalServer);

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

describe("DiscoveredLocalServer", () => {
  it("keeps the kind of a named or tunneled server URL", () => {
    const server = decodeDiscoveredLocalServer({
      host: "localhost",
      port: 5173,
      url: "https://feature.ngrok-free.app",
      urlKind: "public-tunnel",
      processName: "node",
      pid: 12345,
      terminal: null,
    });
    expect(server.urlKind).toBe("public-tunnel");
    expect(() => decodeDiscoveredLocalServer({ ...server, urlKind: "somewhere-else" })).toThrow();
  });
});
