import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chooseAssistantEnvironment } from "./assistant-environment";

const desk = EnvironmentId.make("desk");
const laptop = EnvironmentId.make("laptop");
const legacy = EnvironmentId.make("legacy");
const server = EnvironmentId.make("server");

const environments = [
  {
    environmentId: server,
    environmentLabel: "Server",
    isEnabled: true,
    connectionState: "connected",
    supportsBots: true,
  },
  {
    environmentId: laptop,
    environmentLabel: "Laptop",
    isEnabled: true,
    connectionState: "connected",
    supportsBots: true,
  },
  {
    environmentId: desk,
    environmentLabel: "Desk",
    isEnabled: true,
    connectionState: "offline",
    supportsBots: true,
  },
  {
    environmentId: legacy,
    environmentLabel: "Aardvark",
    isEnabled: true,
    connectionState: "connected",
    supportsBots: false,
  },
];

describe("assistant environment", () => {
  it("follows the environment the Code list is filtered to", () => {
    expect(
      chooseAssistantEnvironment({ environments, selectedEnvironmentId: server, projects: [] }),
    ).toBe(server);
  });

  it("keeps a filtered environment that is too old for bots instead of using another", () => {
    expect(
      chooseAssistantEnvironment({
        environments,
        selectedEnvironmentId: legacy,
        projects: [{ environmentId: laptop, botRole: "assistant" }],
      }),
    ).toBe(legacy);
  });

  it("keeps a filtered environment that is disconnected instead of using another", () => {
    expect(
      chooseAssistantEnvironment({
        environments,
        selectedEnvironmentId: desk,
        projects: [{ environmentId: laptop, botRole: "assistant" }],
      }),
    ).toBe(desk);
  });

  it("falls back when the filtered environment no longer exists", () => {
    expect(
      chooseAssistantEnvironment({
        environments,
        selectedEnvironmentId: EnvironmentId.make("removed"),
        projects: [],
      }),
    ).toBe(laptop);
  });

  it("prefers an environment that already has an Assistant over creating another", () => {
    expect(
      chooseAssistantEnvironment({
        environments,
        selectedEnvironmentId: null,
        projects: [{ environmentId: server, botRole: "assistant" }],
      }),
    ).toBe(server);
  });

  it("never falls back to an environment without bots or a connection", () => {
    expect(
      chooseAssistantEnvironment({
        environments: environments.filter(
          (environment) =>
            environment.environmentId === legacy || environment.environmentId === desk,
        ),
        selectedEnvironmentId: null,
        projects: [{ environmentId: desk, botRole: "assistant" }],
      }),
    ).toBeNull();
    expect(
      chooseAssistantEnvironment({
        environments: environments.map((environment) => ({ ...environment, isEnabled: false })),
        selectedEnvironmentId: null,
        projects: [],
      }),
    ).toBeNull();
  });
});
