import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("requires voice settings support to be advertised separately from bot conversations", () => {
    expect(decodeDescriptor(descriptor).capabilities.botVoiceConfiguration).toBeUndefined();
    const decoded = decodeDescriptor({ ...descriptor, capabilities: { botConversations: true } });
    expect(decoded.capabilities.botVoiceConfiguration).toBeUndefined();
    expect(
      decodeDescriptor({ ...descriptor, capabilities: { botVoiceConfiguration: true } })
        .capabilities.botVoiceConfiguration,
    ).toBe(true);
  });
  it("keeps bot conversations disabled for older environments unless advertised", () => {
    expect(decodeDescriptor(descriptor).capabilities.botConversations).toBeUndefined();
    expect(
      decodeDescriptor({ ...descriptor, capabilities: { botConversations: true } }).capabilities
        .botConversations,
    ).toBe(true);
  });
  it("decodes old, recognized and future manual installation descriptors", () => {
    expect(decodeDescriptor(descriptor).capabilities.serverInstallation).toBeUndefined();
    for (const installation of [{ kind: "npx" }, { kind: "npm-global", prefix: "/opt/node" }]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toEqual(installation);
    }
    for (const installation of [{ kind: "future-manager" }, { kind: "npm-global" }]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toBeUndefined();
    }
  });
});
