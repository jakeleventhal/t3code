import { RelayConnectionTarget } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveRemoteOpenState } from "./remoteOpen";

const r2d2EnvironmentId = EnvironmentId.make("15405915-756f-4970-9c8f-e8b61a021fd4");
const macbotEnvironmentId = EnvironmentId.make("7a80c1f1-4401-4164-ab6e-406e4df91650");
const advertisedTargets = [
  { kind: "tailscale", host: "sol.tail1234.ts.net" },
  { kind: "mdns", host: "sol.local" },
] as const;

describe("personal remote username compatibility", () => {
  it.each([
    [r2d2EnvironmentId, "r2d2"],
    [macbotEnvironmentId, "macbot"],
  ])("adds the remote username in Desktop for %s", (environmentId, username) => {
    expect(
      resolveRemoteOpenState({
        target: new RelayConnectionTarget({ environmentId, label: username }),
        sshTarget: null,
        isDesktopRenderer: true,
        remoteOpenTargets: advertisedTargets,
      }),
    ).toEqual({
      mode: "remote-links",
      host: { kind: "tailscale", host: "sol.tail1234.ts.net", username },
    });
  });

  it("does not add the personal remote username in a browser", () => {
    expect(
      resolveRemoteOpenState({
        target: new RelayConnectionTarget({
          environmentId: r2d2EnvironmentId,
          label: "r2d2",
        }),
        sshTarget: null,
        isDesktopRenderer: false,
        remoteOpenTargets: advertisedTargets,
      }),
    ).toEqual({
      mode: "remote-links",
      host: { kind: "tailscale", host: "sol.tail1234.ts.net" },
    });
  });

  it("keeps a server-advertised username for a personal remote", () => {
    expect(
      resolveRemoteOpenState({
        target: new RelayConnectionTarget({ environmentId: macbotEnvironmentId, label: "MacBot" }),
        sshTarget: null,
        isDesktopRenderer: true,
        remoteOpenTargets: [
          { kind: "tailscale", host: "macbot.tail1234.ts.net", username: "server-user" },
        ],
      }),
    ).toEqual({
      mode: "remote-links",
      host: {
        kind: "tailscale",
        host: "macbot.tail1234.ts.net",
        username: "server-user",
      },
    });
  });
});
