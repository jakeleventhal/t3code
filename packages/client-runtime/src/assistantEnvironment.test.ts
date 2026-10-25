import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chooseAssistantEnvironment,
  environmentAssistant,
  environmentAssistants,
} from "./assistantEnvironment.ts";

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

const assistant = (environmentId: EnvironmentId, createdAt: string, id = `${environmentId}-a`) => ({
  environmentId,
  id,
  botRole: "assistant" as const,
  createdAt,
});

describe("chooseAssistantEnvironment", () => {
  it("designates the oldest Assistant when several environments have one", () => {
    expect(
      chooseAssistantEnvironment({
        environments,
        projects: [assistant(laptop, "2026-03-01"), assistant(server, "2026-02-01")],
      }),
    ).toBe(server);
  });

  it("keeps an offline Assistant designated instead of starting one elsewhere", () => {
    expect(
      chooseAssistantEnvironment({
        environments,
        projects: [assistant(desk, "2026-01-01")],
      }),
    ).toBe(desk);
  });

  it("ignores Assistants on disabled environments", () => {
    expect(
      chooseAssistantEnvironment({
        environments: environments.map((environment) =>
          environment.environmentId === desk ? { ...environment, isEnabled: false } : environment,
        ),
        projects: [assistant(desk, "2026-01-01")],
      }),
    ).toBe(laptop);
  });

  it("starts the first Assistant only on a connected environment with bots", () => {
    expect(chooseAssistantEnvironment({ environments, projects: [] })).toBe(laptop);
    expect(
      chooseAssistantEnvironment({
        environments: environments.filter(
          (environment) =>
            environment.environmentId === legacy || environment.environmentId === desk,
        ),
        projects: [],
      }),
    ).toBeNull();
  });
});

describe("environmentAssistant", () => {
  it("picks the environment's oldest Assistant, as its server does", () => {
    const older = assistant(server, "2026-01-01", "b");
    const sameTime = assistant(server, "2026-01-01", "c");
    const projects = [
      assistant(server, "2026-05-01", "a"),
      sameTime,
      older,
      assistant(laptop, "2025-01-01"),
      { environmentId: server, id: "s", botRole: "specialist" as const, createdAt: "2020-01-01" },
    ];
    expect(environmentAssistant(projects, server)).toBe(older);
    expect(environmentAssistant(projects, desk)).toBeNull();
    expect(environmentAssistant(projects, null)).toBeNull();
    expect(environmentAssistants(projects, server).map((project) => project.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});
