import {
  BOT_AVATAR_MAX_BYTES,
  type BotAvatarImage,
  type ProjectBotRole,
  type ThreadId,
} from "@t3tools/contracts";
import { parseBase64DataUrl, inferImageExtension } from "../imageMime.ts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class BotWorkspaceError extends Schema.TaggedError<BotWorkspaceError>()(
  "BotWorkspaceError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read or prepare the bot's instructions.";
  }
}

export class BotWorkspace extends Context.Service<
  BotWorkspace,
  {
    readonly writeAvatar: (
      root: string,
      image: BotAvatarImage,
    ) => Effect.Effect<string, BotWorkspaceError>;
    readonly initialize: (
      root: string,
      role: ProjectBotRole,
    ) => Effect.Effect<void, BotWorkspaceError>;
    readonly read: (root: string, role: ProjectBotRole) => Effect.Effect<string, BotWorkspaceError>;
    readonly conversation: (
      root: string,
      threadId: ThreadId,
    ) => Effect.Effect<{ readonly file: string; readonly text: string }, BotWorkspaceError>;
  }
>()("t3/bots/BotWorkspace") {}

function initialInstructions(role: ProjectBotRole): string {
  return [
    "# Purpose",
    "",
    role === "assistant"
      ? "Help me navigate T3 Code, discuss what I'm looking at, and coordinate my work."
      : "Follow the purpose and preferences I give you in our conversations.",
    "",
    "# Saved memory",
    "",
  ].join("\n");
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const writeAvatar = Effect.fn("BotWorkspace.writeAvatar")(
    function* (root: string, image: BotAvatarImage) {
      const data = parseBase64DataUrl(image.dataUrl);
      if (data === null || data.mimeType !== image.mimeType) {
        return yield* new BotWorkspaceError({ path: root, cause: "Invalid image data." });
      }
      const bytes = yield* Effect.fromResult(Base64.decode(data.base64));
      if (bytes.length === 0 || bytes.length > BOT_AVATAR_MAX_BYTES) {
        return yield* new BotWorkspaceError({ path: root, cause: "Invalid image size." });
      }
      const digest = yield* crypto.digest("SHA-256", bytes).pipe(Effect.map(Hex.encode));
      // A new path per image keeps remote clients' favicon caches coherent.
      const relativePath = `.avatars/${digest}${inferImageExtension(image)}`;
      yield* fs.makeDirectory(path.join(root, ".avatars"), { recursive: true });
      yield* fs.writeFile(path.join(root, relativePath), bytes, { flag: "wx" }).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.void,
        ),
      );
      return relativePath;
    },
    (effect, root) =>
      effect.pipe(Effect.mapError((cause) => new BotWorkspaceError({ path: root, cause }))),
  );
  const readFile = Effect.fn("BotWorkspace.readFile")(
    function* (filePath: string, budget: number) {
      const file = yield* fs.open(filePath, { flag: "r" });
      const bytes = yield* file.readAlloc(budget + 1);
      if (Option.isNone(bytes)) return { text: "", truncated: false };
      const truncated = bytes.value.length > budget;
      return {
        text: new TextDecoder().decode(bytes.value.subarray(0, budget), { stream: truncated }),
        truncated,
      };
    },
    Effect.scoped,
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed(null),
    ),
  );
  const initialize = Effect.fn("BotWorkspace.initialize")(
    function* (root: string, role: ProjectBotRole) {
      // Exclusive creation preserves edits when provisioning is retried or races another open.
      yield* fs
        .writeFileString(path.join(root, "AGENTS.md"), initialInstructions(role), { flag: "wx" })
        .pipe(
          Effect.catchIf(
            (error) => error.reason._tag === "AlreadyExists",
            () => Effect.void,
          ),
        );
    },
    (effect, root) =>
      effect.pipe(Effect.mapError((cause) => new BotWorkspaceError({ path: root, cause }))),
  );
  const read = Effect.fn("BotWorkspace.read")(
    function* (root: string, role: ProjectBotRole) {
      const result = yield* readFile(path.join(root, "AGENTS.md"), 8192);
      if (result === null) return initialInstructions(role);
      return result.truncated
        ? `${result.text}\n[More bot instructions are available to the work agent in AGENTS.md.]`
        : result.text;
    },
    (effect, root) =>
      effect.pipe(Effect.mapError((cause) => new BotWorkspaceError({ path: root, cause }))),
  );
  const conversation = Effect.fn("BotWorkspace.conversation")(
    function* (root: string, threadId: ThreadId) {
      // Thread ids may contain separators or exceed a filesystem's filename limit.
      const digest = yield* crypto
        .digest("SHA-256", new TextEncoder().encode(threadId))
        .pipe(Effect.map(Hex.encode));
      const file = `conversations/${digest}.md`;
      const result = yield* readFile(path.join(root, file), 4096);
      return {
        file,
        text:
          result === null
            ? ""
            : `${result.text}${result.truncated ? "\n[Remaining conversation brief omitted; read the file for details.]" : ""}`,
      };
    },
    (effect, root) =>
      effect.pipe(Effect.mapError((cause) => new BotWorkspaceError({ path: root, cause }))),
  );
  return BotWorkspace.of({ initialize, read, conversation, writeAvatar });
});

export const layer = Layer.effect(BotWorkspace, make);
