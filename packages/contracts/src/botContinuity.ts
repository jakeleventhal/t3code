import * as Schema from "effect/Schema";
import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";
export const BotId = TrimmedNonEmptyString.check(Schema.isMaxLength(200)).pipe(
  Schema.brand("BotId"),
);
export type BotId = typeof BotId.Type;

export const BOT_CONTINUITY_FILE_BYTES = 256 * 1024;
export const BOT_CONTINUITY_TOTAL_BYTES = 4 * 1024 * 1024;

export const BotContinuityFileReference = Schema.Struct({
  environmentId: EnvironmentId,
  path: Schema.String.check(Schema.isMaxLength(1024)),
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const BotContinuityFiles = Schema.Struct({
  version: Schema.Literal(1),
  botId: BotId,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String.check(Schema.isMaxLength(1024)),
      text: Schema.String.check(Schema.isMaxLength(BOT_CONTINUITY_FILE_BYTES)),
    }),
  ).check(Schema.isMaxLength(1024)),
  localFiles: Schema.Array(BotContinuityFileReference).check(Schema.isMaxLength(4096)),
});
export type BotContinuityFiles = typeof BotContinuityFiles.Type;

// Uploads and general workspace files are deliberately outside the continuity set.
export function isBotContinuityPath(path: string): boolean {
  if (path.startsWith("memory/replica-conflicts/")) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:]/.test(part)))
    return false;
  if ([...path].some((character) => character.charCodeAt(0) < 32)) return false;
  if (parts.length === 1) return ["AGENTS.md", "CLAUDE.md", "MEMORY.md", "SOUL.md"].includes(path);
  return ["memory/", "conversations/", "skills/", ".agents/skills/", ".claude/skills/"].some(
    (prefix) => path.startsWith(prefix),
  );
}
