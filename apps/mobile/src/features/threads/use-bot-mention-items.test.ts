import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

vi.mock("../../state/bots", () => ({ botEnvironment: {} }));
vi.mock("../../state/entities", () => ({ useEnvironmentServerConfig: () => null }));
vi.mock("../../state/projects", () => ({ environmentProjects: {} }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => null }));
vi.mock("../../state/queries", () => ({ useDebouncedValue: (value: unknown) => value }));
vi.mock("../../state/workspace", () => ({ workspaceConnections: {} }));

import { botMentionEnvironments } from "./use-bot-mention-items";

describe("botMentionEnvironments", () => {
  it("lets a bot read its own machine and connected ones, never offline ones", () => {
    const home = EnvironmentId.make("env-home");
    const laptop = EnvironmentId.make("env-laptop");
    const offline = EnvironmentId.make("env-offline");

    const readable = botMentionEnvironments(
      [
        { environmentId: home, environmentLabel: "Home", connectionState: "connecting" },
        { environmentId: laptop, environmentLabel: "Laptop", connectionState: "connected" },
        { environmentId: offline, environmentLabel: "Studio", connectionState: "offline" },
      ],
      home,
    );

    expect([...readable]).toEqual([
      [home, "Home"],
      [laptop, "Laptop"],
    ]);
  });
});
