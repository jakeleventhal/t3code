import { McpAttachmentInput } from "../attachment/input.ts";
import {
  EnvironmentId,
  BotOpenInput,
  BotCreateInput,
  BotThreadCreateInput,
  BotConversationResult,
  BotFilesInput,
  BotFilesPage,
  NonNegativeInt,
  ModelSelection,
  TrimmedNonEmptyString,
  ThreadId,
  RunId,
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  RuntimeMode,
  ProviderInteractionMode,
  Project,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  ProjectId,
  OrchestratorMcpFailure,
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ServerConfig from "../../../config.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { Tool, Toolkit } from "effect/ai";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as BotService from "../../../bots/BotService.ts";
import * as VoiceCalls from "../../../bots/VoiceCalls.ts";
import { VoiceTranscriptPage, VoiceTranscriptPageInput } from "@t3tools/contracts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PeerEnvironmentService from "../../PeerEnvironmentService.ts";

const shared = {
  success: Project,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    Crypto.Crypto,
  ],
};
const ProjectListTool = Tool.make("t3_project_list", {
  ...shared,
  description: "List projects. Pages can shift.",
  parameters: Schema.Struct({
    cursor: Schema.optional(NonNegativeInt),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  }),
  success: Schema.Struct({
    projects: Schema.Array(Project),
    nextCursor: Schema.NullOr(NonNegativeInt),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const ProjectReadTool = Tool.make("t3_project_read", {
  ...shared,
  description: "Read one project: workspace and saved scripts.",
  parameters: Schema.Struct({ projectId: ProjectId }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const ProjectCreateTool = Tool.make("t3_project_create", {
  ...shared,
  description:
    "Register a project folder. `createWorkspaceRootIfMissing` creates it; a registered folder is rejected. No `workspaceRoot`: makes a git repo from `title` with README, icon, first commit (`commitError` on failure; project still exists). Clone first with `t3_project_clone` if needed.",
  parameters: Schema.Struct({
    ...ProjectCreatePayload.fields,
    workspaceRoot: Schema.optional(ProjectCreatePayload.fields.workspaceRoot),
  }),
  success: Schema.Struct({ ...Project.fields, commitError: Schema.optional(Schema.String) }),
  dependencies: [...shared.dependencies, ManagedProjectFolders.ManagedProjectFolders],
}).annotate(Tool.Destructive, true);
const ProjectUpdateTool = Tool.make("t3_project_update", {
  ...shared,
  description: "Update one project's settings. Omitted fields are unchanged.",
  parameters: Schema.Struct({ projectId: ProjectId, ...ProjectUpdatePayload.fields }),
}).annotate(Tool.Destructive, true);
const ProjectDeleteTool = Tool.make("t3_project_delete", {
  ...shared,
  description: "Delete one project. Nonempty needs `force: true`. Folder on disk stays.",
  parameters: Schema.Struct({ projectId: ProjectId, force: Schema.optionalKey(Schema.Boolean) }),
}).annotate(Tool.Destructive, true);
const ProjectCloneTool = Tool.make("t3_project_clone", {
  ...shared,
  description:
    "Clone a repository (`destinationPath` new or empty). Register after with `t3_project_create`.",
  parameters: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  dependencies: [
    ...shared.dependencies,
    SourceControlRepositoryService.SourceControlRepositoryService,
  ],
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const ThreadLaunchTool = Tool.make("t3_thread_launch", {
  ...shared,
  description:
    "Create one new top-level thread, bound to its workspace before the agent starts. Task in `message`. Omit `projectId`, model and modes to inherit yours (outside a thread, pass `projectId` or `scratch`); modes cannot exceed yours. No retry key: after an error or lost reply, check `t3_thread_list` before retrying. Follow it with `t3_thread_read` or `t3_thread_wait`. Mention it with its `link`. To launch on another environment set environmentId, projectId and modelSelection from t3_environment_catalog.",
  parameters: Schema.Struct({
    environmentId: Schema.optional(EnvironmentId),
    projectId: Schema.optional(ProjectId),
    scratch: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "No project: a new Scratch folder. Not with `projectId` or `workspaceStrategy`. To launch on another environment set environmentId, projectId and modelSelection from t3_environment_catalog.",
      }),
    ),
    title: TrimmedNonEmptyString,
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    workspaceStrategy: Schema.optional(
      OrchestrationV2ThreadLaunchWorkspaceStrategy.annotate({
        description:
          "'worktree': new checkout from `baseRef`. 'existing_worktree': bind `worktreePath`, a project worktree. 'root': project checkout, the default, not your worktree. Stack: parent branch as `baseRef`, `startFromOrigin: false`. Uncommitted edits are not copied. To launch on another environment set environmentId, projectId and modelSelection from t3_environment_catalog.",
      }),
    ),
    message: Schema.optional(
      Schema.String.check(Schema.isMaxLength(120000)).annotate({
        description: "First prompt. Omit it and `attachments` for idle.",
      }),
    ),
    attachments: Schema.optional(Schema.Array(McpAttachmentInput).check(Schema.isMaxLength(8))),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    link: Schema.optional(Schema.String),
    projectId: ProjectId,
    modelSelection: ModelSelection,
    runId: Schema.NullOr(RunId),
    status: Schema.NullOr(OrchestrationV2RunStatus),
  }),
  dependencies: [
    PeerEnvironmentService.PeerEnvironmentService,
    ...shared.dependencies,
    ThreadLaunchService.ThreadLaunchService,
    ManagedProjectFolders.ManagedProjectFolders,
    GitVcsDriver.GitVcsDriver,
    FileSystem.FileSystem,
    ServerConfig.ServerConfig,
    ServerSettings.ServerSettingsService,
    DocumentText.DocumentText,
  ],
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const BotOpenTool = Tool.make("t3_bot_open", {
  ...shared,
  description:
    "Open a bot's durable main conversation. Omit projectId for this environment's Assistant. Creates the conversation only when absent; does not send a message or change an existing conversation's model or modes. To launch on another environment set environmentId, projectId and modelSelection from t3_environment_catalog.",
  parameters: BotOpenInput.mapFields(Struct.omit(["creationSource"])),
  success: BotConversationResult,
  dependencies: [...shared.dependencies, BotService.BotService],
}).annotate(Tool.Destructive, false);

const BotCreateTool = Tool.make("t3_bot_create", {
  ...shared,
  description:
    "Create a specialist bot with its own workspace and main conversation. Reuse the same commandId when retrying the same request; different commandIds create distinct bots. Does not start an agent turn.",
  parameters: BotCreateInput.mapFields(Struct.omit(["creationSource"])),
  success: BotConversationResult,
  dependencies: [...shared.dependencies, BotService.BotService],
}).annotate(Tool.Destructive, false);

export const ProjectToolkit = Toolkit.make(
  Tool.make("t3_bot_thread_create", {
    ...shared,
    description:
      "Create a named secondary thread for substantial parallel work in an existing bot. Uses that bot's model and permissions; leaves its main conversation unchanged. Reuse commandId when retrying. Does not send a message or start work: send the task to the returned thread with t3_thread_send. Prefer the main conversation for ordinary requests and reuse existing threads for ongoing work.",
    parameters: BotThreadCreateInput,
    success: BotConversationResult,
    dependencies: [...shared.dependencies, BotService.BotService],
  }).annotate(Tool.Destructive, false),
  Tool.make("t3_bot_files", {
    description:
      "List files shared in this bot's conversations and published reports, newest first. Pass nextCursor as cursor to continue. This lists chat assets with source conversation references, not the bot's working directory.",
    parameters: BotFilesInput,
    success: BotFilesPage,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext.McpInvocationContext, BotService.BotService],
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_bot_call_read", {
    description:
      "Read a page of a bot call's saved text transcript. Use the callId from the voice_call timeline card in t3_thread_read(view=activity). Pass nextOrdinal as afterOrdinal to continue; null means the end. Audio is never stored. This does not start a call or access a microphone.",
    parameters: VoiceTranscriptPageInput,
    success: VoiceTranscriptPage,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext.McpInvocationContext, VoiceCalls.VoiceCalls],
  }).annotate(Tool.Readonly, true),
  BotOpenTool,
  BotCreateTool,
  ThreadLaunchTool,
  ProjectListTool,
  ProjectReadTool,
  ProjectCreateTool,
  ProjectUpdateTool,
  ProjectDeleteTool,
  ProjectCloneTool,
);
