/** A short conversation-list label, without the most common Markdown decorations. */
export function botPreviewText(text: string | null | undefined): string | null {
  if (!text) return null;
  return (
    text
      .replace(/^ {0,3}(?:#{1,6} |>[ ]?|[-+*] |\d+[.)] )/gm, "")
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(`+)([^`]+)\1/g, "$2")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|\s)\*([^*]+)\*(?=\s|[.,!?]|$)/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}
