import type { LiveActivityComponent } from "expo-widgets";
import { isValidElement } from "react";
import { expect, it, vi } from "vite-plus/test";

import {
  AgentActivity,
  type AgentActivityRowProps,
  type AgentActivityProps,
} from "./AgentActivity";

vi.mock("expo-widgets", () => ({
  createLiveActivity: () => ({}),
  createWidget: () => ({}),
}));
vi.mock("@expo/ui/swift-ui", () => ({
  Divider: "Divider",
  HStack: "HStack",
  Image: "Image",
  Text: "Text",
  Spacer: "Spacer",
  VStack: "VStack",
  ZStack: "ZStack",
}));
vi.mock("@expo/ui/swift-ui/modifiers", () =>
  Object.fromEntries(
    [
      "accessibilityElement",
      "accessibilityLabel",
      "activityBackgroundTint",
      "containerBackground",
      "aspectRatio",
      "font",
      "foregroundStyle",
      "frame",
      "layoutPriority",
      "lineLimit",
      "minimumScaleFactor",
      "multilineTextAlignment",
      "padding",
      "resizable",
      "widgetURL",
    ].map((name) => [name, (value: unknown) => ({ name, value })]),
  ),
);

it.each([-1, 0, 1])(
  "does not infer completion from five capped terminal rows: active=%s",
  (activeCount) => {
    const activity: AgentActivityProps = {
      title: "T3 Code",
      subtitle: "",
      activeCount,
      isExpired: true,
      updatedAt: "2026-10-28T10:00:00Z",
      activities: Array.from({ length: 5 }, (_, index) => ({
        environmentId: "environment",
        threadId: String(index),
        projectTitle: "Project",
        threadTitle: "Finished task",
        modelTitle: "Codex",
        phase: "completed",
        status: "Done",
        updatedAt: "2026-10-28T10:00:00Z",
        deepLink: "/",
      })),
    };
    const compact = AgentActivity(activity, { colorScheme: "dark" }).compactTrailing;
    expect(isValidElement(compact)).toBe(true);
    if (!isValidElement<{ children: string }>(compact)) return;
    expect(compact.props.children).toBe(activeCount === 0 ? "Done" : "Out of date");
  },
);

it("targets the first displayed attention thread when incoming rows are unordered", () => {
  const render = AgentActivity as unknown as LiveActivityComponent<AgentActivityProps>;
  const older: AgentActivityRowProps = {
    environmentId: "environment",
    threadId: "older",
    projectTitle: "Project",
    threadTitle: "Older request",
    modelTitle: "Codex",
    phase: "waiting_for_approval",
    status: "Approval needed",
    updatedAt: "2026-10-28T09:00:00Z",
    deepLink: "/threads/environment/older",
  };
  const newer = {
    ...older,
    threadId: "newer",
    phase: "woke" as const,
    updatedAt: "2026-10-28T10:00:00Z",
    deepLink: "/threads/environment/newer",
  };
  const layout = render(
    {
      title: "Agents",
      subtitle: "",
      activeCount: 2,
      updatedAt: newer.updatedAt,
      activities: [older, newer],
    },
    { colorScheme: "dark" },
  );
  const compact = layout.compactTrailing;
  expect(isValidElement(compact)).toBe(true);
  if (!isValidElement<{ children: string; modifiers: unknown[] }>(compact)) return;
  expect(compact.props.children).toBe("Woke");
  expect(compact.props.modifiers).toContainEqual({
    name: "widgetURL",
    value: "t3code://threads/environment/newer",
  });
  expect(layout.minimal).toMatchObject({
    props: {
      children: { props: { systemName: "alarm.fill" } },
      modifiers: expect.arrayContaining([
        { name: "widgetURL", value: "t3code://threads/environment/newer" },
      ]),
    },
  });
});
