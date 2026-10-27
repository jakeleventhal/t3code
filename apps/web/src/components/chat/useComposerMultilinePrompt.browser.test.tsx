import "../../index.css";
import { createRef, useState } from "react";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";
import { ComposerPromptEditor } from "../ComposerPromptEditor";
import { COMPOSER_RESTING_EDITOR_CLASS_NAME } from "../composerFooterLayout";
import { useComposerMultilinePrompt } from "./useComposerMultilinePrompt";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import { imageContextReference } from "../../lib/composerContextRecords";
import { formatInlineContextReference } from "../../lib/composerContextReferences";

it("keeps an image-reference draft stable when compact controls reduce the available width", async () => {
  const image: ComposerImageAttachment = {
    type: "image",
    id: "reference-image",
    name: "DAEABC54-8CE8-42B3-9DB1-4B4B6239E301.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 461200,
    file: new File(["fixture"], "reference.jpg", { type: "image/jpeg" }),
    previewUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  };
  const reference = imageContextReference(image);
  const value = `Change your avatar to a ${formatInlineContextReference(reference)} `;
  let transitions = 0;
  function Composer() {
    const [multiline, bodyRef] = useComposerMultilinePrompt();
    const [prior, setPrior] = useState(multiline);
    if (prior !== multiline) {
      transitions++;
      setPrior(multiline);
    }
    return (
      <div ref={bodyRef} style={{ width: 598, padding: 16, boxSizing: "border-box" }}>
        <div style={{ width: multiline ? "100%" : 446 }}>
          <ComposerPromptEditor
            editorRef={createRef()}
            value={value}
            cursor={value.length}
            richTextEnabled
            contextRecords={new Map([[reference.contextId, { kind: "image", record: image }]])}
            skills={[]}
            disabled={false}
            placeholder=""
            className={multiline ? "" : COMPOSER_RESTING_EDITOR_CLASS_NAME}
            onChange={() => {}}
            onPaste={() => {}}
          />
        </div>
      </div>
    );
  }
  await using screen = await render(<Composer />);
  const editor = screen.container.querySelector<HTMLElement>('[data-testid="composer-editor"]')!;
  expect(editor.textContent).toContain("Change your avatar");
  // Clicking waits for stable geometry. The regression keeps moving this chip every frame.
  await screen.getByRole("button", { name: /Image attachment/ }).click();
  expect(transitions).toBeLessThan(4);
});
