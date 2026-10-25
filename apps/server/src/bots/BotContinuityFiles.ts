// @effect-diagnostics nodeBuiltinImport:off - File-descriptor validation and no-follow opens keep continuity capture inside its workspace.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  BOT_CONTINUITY_FILE_BYTES,
  BOT_CONTINUITY_TOTAL_BYTES,
  BotContinuityFiles,
  isBotContinuityPath,
  type BotId,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class BotContinuityFilesError extends Schema.TaggedError<BotContinuityFilesError>()(
  "BotContinuityFilesError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The bot's instructions and memory could not be copied.";
  }
}

const decode = Schema.decodeUnknownSync(BotContinuityFiles);
const roots = [
  "AGENTS.md",
  "CLAUDE.md",
  "MEMORY.md",
  "SOUL.md",
  "memory",
  "conversations",
  "skills",
  ".agents/skills",
  ".claude/skills",
];
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

export const capture = Effect.fn("BotContinuityFiles.capture")(
  (input: {
    readonly botId: BotId;
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string;
  }) =>
    Effect.tryPromise({
      try: async () => {
        const files: Array<BotContinuityFiles["files"][number]> = [];
        const localFiles: Array<BotContinuityFiles["localFiles"][number]> = [];
        const root = await NodeFSP.realpath(input.workspaceRoot);
        let total = 0;
        const visit = async (relative: string) => {
          if (relative === "memory/replica-conflicts") return;
          const absolute = NodePath.join(root, relative);
          const info = await NodeFSP.lstat(absolute);
          if (info.isSymbolicLink()) throw new Error("Continuity files cannot be symbolic links.");
          if ((await NodeFSP.realpath(absolute)) !== absolute)
            throw new Error("Continuity path escaped its workspace.");
          if (info.isDirectory()) {
            for (const name of (await NodeFSP.readdir(absolute)).sort())
              await visit(`${relative}/${name}`);
            return;
          }
          if (!info.isFile() || !isBotContinuityPath(relative))
            throw new Error("Invalid continuity file.");
          if (files.length + localFiles.length >= 1024)
            throw new Error("Too many continuity files.");
          const reference = { environmentId: input.environmentId, path: relative, size: info.size };
          if (info.size > BOT_CONTINUITY_FILE_BYTES) {
            localFiles.push(reference);
            return;
          }
          const handle = await NodeFSP.open(
            absolute,
            NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
          );
          try {
            const before = await handle.stat();
            if (before.size !== info.size || before.ino !== info.ino)
              throw new Error("Continuity file changed during capture.");
            const bytes = Buffer.alloc(BOT_CONTINUITY_FILE_BYTES + 1);
            let length = 0;
            while (length < bytes.length) {
              const read = await handle.read(bytes, length, bytes.length - length, length);
              if (read.bytesRead === 0) break;
              length += read.bytesRead;
            }
            const after = await handle.stat();
            if (
              length !== before.size ||
              before.mtimeMs !== after.mtimeMs ||
              before.ctimeMs !== after.ctimeMs
            )
              throw new Error("Continuity file changed during capture.");
            let text: string;
            try {
              text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
            } catch {
              localFiles.push(reference);
              return;
            }
            if (text.includes("\0")) {
              localFiles.push(reference);
              return;
            }
            total += length;
            if (total > BOT_CONTINUITY_TOTAL_BYTES)
              throw new Error("Continuity text exceeds its size limit.");
            files.push({ path: relative, text });
          } finally {
            await handle.close();
          }
        };
        for (const relative of roots) {
          try {
            await NodeFSP.lstat(NodePath.join(root, relative));
          } catch (error) {
            if (missing(error)) continue;
            throw error;
          }
          await visit(relative);
        }
        return decode({ version: 1, botId: input.botId, files, localFiles });
      },
      catch: (cause) => new BotContinuityFilesError({ cause }),
    }),
);

export const materialize = Effect.fn("BotContinuityFiles.materialize")(
  (parent: string, value: BotContinuityFiles) =>
    Effect.tryPromise({
      try: async () => {
        const input = decode(value);
        const seen = new Set<string>();
        let total = 0;
        for (const file of input.files) {
          const key = file.path.normalize("NFC").toLowerCase();
          const size = Buffer.byteLength(file.text);
          total += size;
          if (
            !isBotContinuityPath(file.path) ||
            seen.has(key) ||
            size > BOT_CONTINUITY_FILE_BYTES ||
            total > BOT_CONTINUITY_TOTAL_BYTES
          )
            throw new Error("Invalid continuity file set.");
          seen.add(key);
        }
        await NodeFSP.mkdir(parent, { recursive: true, mode: 0o700 });
        const directory = await NodeFSP.mkdtemp(NodePath.join(parent, ".continuity-"));
        try {
          for (const file of input.files) {
            const target = NodePath.join(directory, file.path);
            await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
            const handle = await NodeFSP.open(target, "wx", 0o600);
            try {
              await handle.writeFile(file.text);
              await handle.sync();
            } finally {
              await handle.close();
            }
          }
          return directory;
        } catch (error) {
          await NodeFSP.rm(directory, { recursive: true, force: true });
          throw error;
        }
      },
      catch: (cause) => new BotContinuityFilesError({ cause }),
    }),
);

/** A locally edited memory wins over an older replica. Keep divergent text for explicit reconciliation. */
export const reconcile = Effect.fn("BotContinuityFiles.reconcile")(
  (
    workspaceRoot: string,
    snapshot: BotContinuityFiles,
    base: ReadonlyArray<{ readonly path: string; readonly text: string }>,
  ) =>
    Effect.gen(function* () {
      const staging = yield* materialize(NodePath.dirname(workspaceRoot), snapshot);
      return yield* Effect.tryPromise({
        try: async () => {
          const root = await NodeFSP.realpath(workspaceRoot);
          const applied: Array<{ path: string; text: string }> = [];
          for (const file of snapshot.files) {
            const target = NodePath.join(root, file.path);
            let directory = root;
            for (const segment of file.path.split("/").slice(0, -1)) {
              directory = NodePath.join(directory, segment);
              await NodeFSP.mkdir(directory, { recursive: true });
              if ((await NodeFSP.realpath(directory)) !== directory)
                throw new Error("Unsafe continuity parent");
            }
            let current: string | null = null;
            try {
              const handle = await NodeFSP.open(
                target,
                NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
              );
              try {
                current = await handle.readFile("utf8");
              } finally {
                await handle.close();
              }
            } catch (error) {
              if (!missing(error)) throw error;
            }
            if (current === file.text) {
              applied.push(file);
              continue;
            }
            if (
              current !== null &&
              current !== base.find((entry) => entry.path === file.path)?.text
            ) {
              // The original remains untouched. A bounded copy is discoverable beside its memory.
              const conflict = NodePath.join(root, "memory", "replica-conflicts");
              await NodeFSP.mkdir(conflict, { recursive: true });
              if ((await NodeFSP.realpath(conflict)) !== conflict)
                throw new Error("Unsafe conflict directory");
              const name = NodeCrypto.createHash("sha256")
                .update(file.path)
                .update("\0")
                .update(file.text)
                .digest("hex");
              const conflictFile = NodePath.join(conflict, `${name}.md`);
              const handle = await NodeFSP.open(
                conflictFile,
                NodeFS.constants.O_WRONLY |
                  NodeFS.constants.O_CREAT |
                  NodeFS.constants.O_TRUNC |
                  NodeFS.constants.O_NOFOLLOW,
                0o600,
              );
              try {
                await handle.writeFile(
                  `Another copy of ${file.path} changed. Reconcile with the current file; do not repeat any historical tasks.\n\n${file.text}`,
                );
              } finally {
                await handle.close();
              }
              continue;
            }
            // Rename replaces the directory entry, never follows a symlink at the destination.
            await NodeFSP.rename(NodePath.join(staging, file.path), target);
            applied.push(file);
          }
          const removed: string[] = [];
          for (const previous of base) {
            if (
              snapshot.files.some((file) => file.path === previous.path) ||
              snapshot.localFiles.some((file) => file.path === previous.path)
            )
              continue;
            if (!isBotContinuityPath(previous.path)) throw new Error("Invalid continuity baseline");
            const target = NodePath.join(root, previous.path);
            try {
              if ((await NodeFSP.realpath(target)) !== target)
                throw new Error("Unsafe continuity path");
              const handle = await NodeFSP.open(
                target,
                NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
              );
              let current: string;
              try {
                current = await handle.readFile("utf8");
              } finally {
                await handle.close();
              }
              // A deletion follows the snapshot only if this copy has not edited the file.
              if (current !== previous.text) continue;
              await NodeFSP.unlink(target);
              removed.push(previous.path);
            } catch (error) {
              if (!missing(error)) throw error;
              removed.push(previous.path);
            }
          }
          return { applied, removed };
        },
        catch: (cause) => new BotContinuityFilesError({ cause }),
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => NodeFSP.rm(staging, { recursive: true, force: true })),
        ),
      );
    }),
);
