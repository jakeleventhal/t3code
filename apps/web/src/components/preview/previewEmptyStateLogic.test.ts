import { describe, expect, it } from "vite-plus/test";

import { findDiscoveredServerTarget } from "./previewEmptyStateLogic";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

describe("findDiscoveredServerTarget", () => {
  it("finds the listener port for a Portless history URL", () => {
    const server = {
      host: "localhost",
      port: 4058,
      url: "http://100.65.180.100:4058/",
      requestedUrl: "https://artelo.localhost",
      processName: "node",
      pid: 123,
      terminal: null,
      source: "scanner",
      urlKind: "local-proxy",
    } satisfies PreviewableServer;

    expect(
      findDiscoveredServerTarget("https://artelo.localhost/products?sort=new#featured", [server]),
    ).toEqual({ port: 4058, urlKind: "local-proxy" });
    expect(findDiscoveredServerTarget("https://other.localhost/", [server])).toBeUndefined();
  });
});
