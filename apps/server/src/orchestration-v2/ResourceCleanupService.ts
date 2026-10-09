import { ThreadId } from "@t3tools/contracts";
import { worktreeResourceThreadId } from "@t3tools/shared/worktreeResource";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as TerminalManager from "../terminal/Manager.ts";

export class ResourceCleanupError extends Schema.TaggedError<ResourceCleanupError>()(
  "ResourceCleanupError",
  {
    operation: Schema.Literals(["terminal", "preview", "attachment"]),
    threadId: Schema.optional(Schema.String),
    attachmentId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ResourceCleanupService extends Context.Reference<{
  readonly cleanupTerminals: (threadId: string) => Effect.Effect<void, ResourceCleanupError>;
  /** Closes every preview session of the thread; server browser tabs end with them. */
  readonly cleanupPreviews: (threadId: string) => Effect.Effect<void, ResourceCleanupError>;
  readonly cleanupAttachments: (
    attachmentIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, ResourceCleanupError>;
}>("t3/orchestration-v2/ResourceCleanupService", {
  defaultValue: () => ({
    cleanupTerminals: () => Effect.void,
    cleanupPreviews: () => Effect.void,
    cleanupAttachments: () => Effect.void,
  }),
}) {}

export const layer = Layer.effect(
  ResourceCleanupService,
  Effect.gen(function* () {
    const projection = yield* ProjectionStore.ProjectionStoreV2;
    const terminals = yield* TerminalManager.TerminalManager;
    const previews = yield* PreviewManager.PreviewManager;
    const fileSystem = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    // Shared checkout resources close only after its final conversation leaves.
    const sharedOwnerToClose = (threadId: string) => Effect.gen(function* () {
      const thread = yield* projection.getThread(ThreadId.make(threadId));
      if (thread.archivedAt === null && thread.deletedAt === null) return null;
      const snapshot = yield* projection.getShellSnapshot({ location: "active" });
      const owner = worktreeResourceThreadId(thread.projectId, thread.worktreePath);
      const hasSibling = snapshot.threads.some(
        (sibling) =>
          sibling.id !== threadId &&
          worktreeResourceThreadId(sibling.projectId, sibling.worktreePath) === owner,
      );
      return hasSibling ? null : owner;
    });
    return {
      cleanupTerminals: (threadId: string) =>
        Effect.gen(function* () {
          // Legacy thread-owned terminals still need cleanup after upgrading.
          yield* terminals.close({ threadId, deleteHistory: true });
          const owner = yield* sharedOwnerToClose(threadId);
          if (owner) yield* terminals.close({ threadId: owner, deleteHistory: true });
        }).pipe(
          Effect.mapError(
            (cause) => new ResourceCleanupError({ operation: "terminal", threadId, cause }),
          ),
        ),
      cleanupPreviews: (threadId: string) =>
        Effect.gen(function* () {
          yield* previews.close({ threadId: ThreadId.make(threadId) });
          const owner = yield* sharedOwnerToClose(threadId);
          if (owner) yield* previews.close({ threadId: owner });
        }).pipe(
          Effect.mapError(
            (cause) => new ResourceCleanupError({ operation: "preview", threadId, cause }),
          ),
        ),
      cleanupAttachments: (attachmentIds: ReadonlyArray<string>) =>
        Effect.forEach(
          attachmentIds,
          (attachmentId) => {
            const path = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId,
            });
            return path === null
              ? Effect.void
              : fileSystem
                  .remove(path, { force: true })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new ResourceCleanupError({ operation: "attachment", attachmentId, cause }),
                    ),
                  );
          },
          { discard: true, concurrency: 4 },
        ),
    };
  }),
);
