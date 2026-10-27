import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BotAvatar } from "./botAvatar.ts";
import { RepositoryIdentity, ThreadEnvMode } from "./environment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProjectBotRole, ProjectScript, ReceivedProjectIcon } from "./project.ts";

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  botRole: Schema.optional(Schema.NullOr(ProjectBotRole)),
  botReplicaReady: Schema.optional(Schema.Boolean),
  botMainThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  // Opt-in because background sync performs network I/O and may move the checkout.
  autoPull: Schema.optional(Schema.Boolean),
  faviconPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projectIcon: Schema.optional(Schema.NullOr(ReceivedProjectIcon)),
  botAvatar: Schema.optional(Schema.NullOr(BotAvatar)),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;
