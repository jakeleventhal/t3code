// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

let root: Root;
let container: HTMLDivElement;

async function renderActions(
  overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {},
) {
  await act(() => {
    root.render(
      <form onSubmit={(event) => event.preventDefault()}>
        <ComposerPrimaryActions
          compact={false}
          pendingAction={null}
          isRunning
          canInterrupt
          followUpBehavior="queue"
          showPlanFollowUpPrompt={false}
          promptHasText
          isSendBusy={false}
          sendDisabledReason={null}
          isConnecting={false}
          isEnvironmentUnavailable={false}
          isPreparingWorktree={false}
          hasSendableContent
          onPreviousPendingQuestion={() => {}}
          onInterrupt={() => {}}
          onImplementPlanInNewThread={() => {}}
          {...overrides}
        />
      </form>,
    );
  });
}

function sendButton() {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

async function pressModifier(key: "Meta" | "Control", held: boolean) {
  await act(() => {
    window.dispatchEvent(
      new KeyboardEvent(held ? "keydown" : "keyup", {
        key,
        metaKey: key === "Meta" && held,
        ctrlKey: key === "Control" && held,
      }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("composer queue/steer transition", () => {
  it.each(["Meta", "Control"] as const)(
    "morphs the queue icon into the steer icon while %s is held, then restores queue on release",
    async (key) => {
      await renderActions();
      const button = sendButton();
      const svg = button.querySelector("svg");
      const queuePath = svg?.querySelector("path")?.getAttribute("d");
      expect(button.getAttribute("aria-label")).toBe("Queue message");

      await pressModifier(key, true);
      expect(button.getAttribute("aria-label")).toBe("Steer message");
      expect(button.querySelector("svg")).toBe(svg);
      expect(svg?.querySelector("path")?.getAttribute("d")).not.toBe(queuePath);
      await pressModifier(key, false);
      expect(button.getAttribute("aria-label")).toBe("Queue message");
      expect(svg?.querySelector("path")?.getAttribute("d")).toBe(queuePath);
    },
  );

  it.each(["blur", "paste"])("restores queue after %s without a modifier keyup", async (event) => {
    await renderActions();
    await pressModifier("Meta", true);
    expect(sendButton().getAttribute("aria-label")).toBe("Steer message");
    await act(() => {
      window.dispatchEvent(new Event(event));
    });
    expect(sendButton().getAttribute("aria-label")).toBe("Queue message");
  });

  it("reverses the transition for the steer preference and keeps idle sends unchanged", async () => {
    await renderActions({ followUpBehavior: "steer" });
    expect(sendButton().getAttribute("aria-label")).toBe("Steer message");
    const steerPath = sendButton().querySelector("path")?.getAttribute("d");
    await pressModifier("Meta", true);
    expect(sendButton().getAttribute("aria-label")).toBe("Queue message");
    await renderActions({ isRunning: false, followUpBehavior: "steer" });
    expect(sendButton().getAttribute("aria-label")).toBe("Submit message");
    expect(sendButton().querySelector("path")?.getAttribute("d")).not.toBe(steerPath);
  });

  it("settles the animated morph and stops requesting frames", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.useFakeTimers();
    const requestFrame = vi.fn((callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    await renderActions();
    const path = sendButton().querySelector("path")!;
    const queuePath = path.getAttribute("d");
    expect(requestFrame).not.toHaveBeenCalled();
    await pressModifier("Meta", true);
    await act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(path.getAttribute("d")).not.toBe(queuePath);
    expect(requestFrame).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await pressModifier("Meta", false);
    await act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(path.getAttribute("d")).toBe(queuePath);
    expect(vi.getTimerCount()).toBe(0);
  });
});
