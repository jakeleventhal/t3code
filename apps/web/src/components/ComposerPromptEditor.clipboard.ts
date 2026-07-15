export const COMPOSER_EDITOR_NAMESPACE = "t3tools-composer-editor";

export function isComposerLexicalClipboardPayload(payload: string): boolean {
  try {
    const parsed: unknown = JSON.parse(payload);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "namespace" in parsed &&
      parsed.namespace === COMPOSER_EDITOR_NAMESPACE &&
      "nodes" in parsed &&
      Array.isArray(parsed.nodes)
    );
  } catch {
    return false;
  }
}
