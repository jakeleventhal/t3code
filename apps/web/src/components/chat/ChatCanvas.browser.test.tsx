import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { ChatCanvas } from "./ChatCanvas";
import { useChatCanvas } from "./ChatCanvasContext";

let canvas: ReturnType<typeof useChatCanvas>;

function Preview({ x, y }: { x: number; y: number }) {
  const current = useChatCanvas();
  useLayoutEffect(() => {
    canvas = current;
  }, [current]);
  const reportPreview = current?.reportPreview;
  useLayoutEffect(() => {
    reportPreview?.({
      key: "browser:one",
      width: 240,
      source: { width: 240, height: 365 },
      position: { x, y },
      lastInteraction: "drag",
    });
  }, [reportPreview, x, y]);
  return null;
}

it("keeps a preview pushed above the composer clear of the Assistant orb over it", async () => {
  using _width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  using _height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1000);
  using _bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-test-composer-overlay")) return new DOMRect(200, 900, 900, 200);
      if (this.hasAttribute("data-assistant-orb-slot")) return new DOMRect(1050, 860, 32, 32);
      return new DOMRect(200, 100, 1800, 1000);
    });
  using _styles = vi.spyOn(window, "getComputedStyle").mockReturnValue({
    paddingLeft: "48px",
    width: "736px",
    minWidth: "640px",
  } as CSSStyleDeclaration);
  const overlay = document.createElement("div");
  overlay.setAttribute("data-test-composer-overlay", "");
  const slot = document.createElement("div");
  slot.setAttribute("data-assistant-orb-slot", "");
  overlay.append(slot);
  await using _screen = await render(
    <ChatCanvas composerOverlayElement={overlay}>
      <Preview x={600} y={623} />
    </ChatCanvas>,
    { router: false },
  );
  const frame = canvas?.layout.frame;
  expect(canvas?.layout.overlapsChat).toBe(true);
  // Canvas top is 100 and the orb's top is 860, with the preview's usual 12px edge gap.
  expect(frame && 100 + frame.y + frame.height).toBe(860 - 12);
});
