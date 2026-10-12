import { describe, expect, it } from "vitest";
import { markdownWithStandaloneMediaLinks } from "./standaloneMediaLinks";

describe("standalone media in Enriched Markdown", () => {
  it("embeds linked and bare images on their own lines", () => {
    expect(markdownWithStandaloneMediaLinks("[Map](https://example.com/map.png)\n\nhttps://example.com/photo.jpg"))
      .toBe("![Map](<https://example.com/map.png>)\n\n![](<https://example.com/photo.jpg>)");
    expect(markdownWithStandaloneMediaLinks("Before\n[Map](https://example.com/map.png)\nAfter"))
      .toBe("Before\n![Map](<https://example.com/map.png>)\nAfter");
  });
  it("keeps inline prose, code, lists, quotes and videos as authored", () => {
    for (const markdown of ["See [Map](https://example.com/map.png).", "`https://example.com/map.png`", "```\nhttps://example.com/map.png\n```", "- [Map](https://example.com/map.png)", "> [Map](https://example.com/map.png)", "[Video](https://example.com/movie.mp4)", "[File](vscode://example/map.png)"]) {
      expect(markdownWithStandaloneMediaLinks(markdown)).toBe(markdown);
    }
  });
  it("requires a workspace for relative images and preserves labels and titles", () => {
    expect(markdownWithStandaloneMediaLinks('[Map](map.png "Caption")')).toBe('[Map](map.png "Caption")');
    expect(markdownWithStandaloneMediaLinks('[Map](map.png "Caption")', "/workspace")).toBe('![Map](<map.png> "Caption")');
    expect(markdownWithStandaloneMediaLinks("[![Map](thumb.png)](full.png)", "/workspace")).toBe("![Map](<full.png>)");
  });
});
