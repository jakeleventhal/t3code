import {
  classifyMarkdownImageSource,
  markdownLinkMediaKind,
} from "@t3tools/client-runtime/markdown-images";
import type { PhrasingContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

function label(node: PhrasingContent): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  return "children" in node ? node.children.map(label).join("") : "";
}

/** Embed image links that occupy a line of a top-level paragraph in native Markdown. */
export function markdownWithStandaloneMediaLinks(
  markdown: string,
  workspaceRoot?: string | null,
): string {
  const root = parser.parse(markdown);
  const edits: Array<{ start: number; end: number; content: string }> = [];
  for (const paragraph of root.children) {
    if (paragraph.type !== "paragraph") continue;
    for (const [index, node] of paragraph.children.entries()) {
      if (node.type !== "link" || markdownLinkMediaKind(node.url) !== "image") continue;
      const source = classifyMarkdownImageSource(node.url, workspaceRoot);
      if (source._tag === "Blocked") continue;
      const previous = paragraph.children[index - 1];
      const next = paragraph.children[index + 1];
      if (previous && (previous.type !== "text" || !/(?:^|\n)[ \t]*$/.test(previous.value)))
        continue;
      if (next && (next.type !== "text" || !/^[ \t]*(?:\n|$)/.test(next.value))) continue;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      const text = node.children.map(label).join("");
      const alt = (text === node.url ? "" : text).replace(/[\\[\]]/g, "\\$&");
      const href = node.url.replace(/</g, "%3C").replace(/>/g, "%3E");
      const title = node.title ? ` "${node.title.replace(/[\\"]/g, "\\$&")}"` : "";
      edits.push({ start, end, content: `![${alt}](<${href}>${title})` });
    }
  }
  // oxlint-disable-next-line unicorn/no-array-reverse -- Hermes has no Array#toReversed.
  for (const edit of [...edits].reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}
