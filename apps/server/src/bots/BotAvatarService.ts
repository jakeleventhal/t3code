import {
  BOT_AVATAR_ASSET_MAX_BYTES,
  BOT_AVATAR_CLIP_KINDS,
  BotAvatarAssetPath,
  BotAvatarError,
  type BotAvatar,
  type BotAvatarAssetReadInput,
  type BotAvatarAssetTransfer,
  type BotAvatarCapabilities,
  type BotAvatarClipKind,
  type BotAvatarDescribeImageInput,
  type BotAvatarDismissInput,
  type BotAvatarErrorReason,
  type BotAvatarGenerateOptionsInput,
  type BotAvatarJob,
  type BotAvatarRetryInput,
  type BotAvatarSelectOptionInput,
  CommandId,
  type Project,
  type ProjectId,
  botAvatarErrorMessage,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import {
  type ProviderMediaGeneration,
  ProviderMediaGenerationError,
} from "@t3tools/provider-core/server/mediaGeneration";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Base64 from "effect/encoding/Base64";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ProjectService from "../project/ProjectService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { isMp4, stripMp4AudioTracks } from "./BotAvatarMedia.ts";
import {
  botAvatarCandidatePrompts,
  botAvatarClipPrompt,
  botAvatarImagePrompt,
} from "./BotAvatarPrompts.ts";

const AVATAR_FOLDER = ".avatars";
const CANDIDATE_COUNT = 4;
const isAssetPath = Schema.is(BotAvatarAssetPath);

export class BotAvatarService extends Context.Service<
  BotAvatarService,
  {
    readonly capabilities: Effect.Effect<BotAvatarCapabilities, BotAvatarError>;
    readonly generateOptions: (
      input: BotAvatarGenerateOptionsInput,
    ) => Effect.Effect<Project, BotAvatarError>;
    readonly selectOption: (
      input: BotAvatarSelectOptionInput,
    ) => Effect.Effect<Project, BotAvatarError>;
    readonly describeImage: (
      input: BotAvatarDescribeImageInput,
    ) => Effect.Effect<Project, BotAvatarError>;
    readonly retry: (input: BotAvatarRetryInput) => Effect.Effect<Project, BotAvatarError>;
    readonly dismiss: (input: BotAvatarDismissInput) => Effect.Effect<Project, BotAvatarError>;
    readonly assetRead: (
      input: BotAvatarAssetReadInput,
    ) => Effect.Effect<BotAvatarAssetTransfer, BotAvatarError>;
    readonly assetReceive: (input: BotAvatarAssetTransfer) => Effect.Effect<void, BotAvatarError>;
    /** Content-addressed files this environment holds for the bot, for replication planning. */
    readonly listAssets: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<BotAvatarAssetPath>, BotAvatarError>;
    /** Settles when no generation job is running; for tests and shutdown. */
    readonly awaitIdle: (projectId: ProjectId) => Effect.Effect<void>;
  }
>()("t3/bots/BotAvatarService") {}

interface MediaProvider {
  readonly instance: ProviderInstance;
  readonly media: ProviderMediaGeneration;
  readonly name: string;
}

const IMAGE_MAGIC: ReadonlyArray<{ readonly bytes: ReadonlyArray<number>; readonly ext: string }> =
  [
    { bytes: [0x89, 0x50, 0x4e, 0x47], ext: "png" },
    { bytes: [0xff, 0xd8, 0xff], ext: "jpg" },
    { bytes: [0x52, 0x49, 0x46, 0x46], ext: "webp" },
  ];

function sniffImageExtension(bytes: Uint8Array): string | null {
  const match = IMAGE_MAGIC.find((entry) =>
    entry.bytes.every((byte, index) => bytes[index] === byte),
  );
  if (match?.ext === "webp" && !(bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42))
    return null;
  return match?.ext ?? null;
}

function fromMediaError(error: ProviderMediaGenerationError): BotAvatarError {
  const reason: BotAvatarErrorReason =
    error.reason === "quota"
      ? "quota"
      : error.reason === "privacy"
        ? "privacy"
        : error.reason === "refused"
          ? "provider-refused"
          : "generation-failed";
  return new BotAvatarError({
    reason,
    ...(error.providerMessage === undefined ? {} : { providerMessage: error.providerMessage }),
    cause: error,
  });
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectService.ProjectService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const locks = yield* KeyedLock.make<string>();
  const launchLocks = yield* KeyedLock.make<string>();
  const jobScope = yield* Scope.make("parallel");
  yield* Effect.addFinalizer(() => Scope.close(jobScope, Exit.void));
  const jobs = new Map<ProjectId, { version: string; fiber: Fiber.Fiber<unknown, never> }>();

  const storage = (projectId?: ProjectId) => (cause: unknown) =>
    new BotAvatarError({
      reason: "storage",
      ...(projectId === undefined ? {} : { projectId }),
      cause,
    });
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const newVersion = crypto.randomUUIDv4().pipe(Effect.mapError(storage()));

  const readBot = Effect.fn("BotAvatarService.readBot")(function* (projectId: ProjectId) {
    const result = yield* projects.getById(projectId).pipe(Effect.mapError(storage(projectId)));
    if (Option.isNone(result) || result.value.botRole == null) {
      return yield* new BotAvatarError({ reason: "not-found", projectId });
    }
    return result.value;
  });

  const mediaProviders = Effect.fn("BotAvatarService.mediaProviders")(function* () {
    const instances = yield* registry.listInstances;
    const ready: Array<MediaProvider> = [];
    const unavailable: Array<string> = [];
    for (const instance of instances) {
      if (!instance.mediaGeneration) continue;
      const name = instance.displayName ?? String(instance.driverKind);
      if (!instance.enabled) {
        unavailable.push(`${name} is turned off`);
        continue;
      }
      const snapshot = yield* instance.snapshot.getSnapshot;
      if (!snapshot.installed) unavailable.push(`${name} isn't installed`);
      else if (snapshot.auth.status !== "authenticated")
        unavailable.push(`${name} isn't signed in`);
      else if (snapshot.status === "error" || snapshot.status === "disabled")
        unavailable.push(snapshot.message ?? `${name} isn't ready`);
      else ready.push({ instance, media: instance.mediaGeneration, name });
    }
    // Grok is the only driver with native video today; keep it first so stills and clips share
    // one account and aesthetic.
    ready.sort(
      (left, right) =>
        Number(right.instance.driverKind === "grok") - Number(left.instance.driverKind === "grok"),
    );
    return { ready, unavailable };
  });

  const capabilities: BotAvatarService["Service"]["capabilities"] = Effect.gen(function* () {
    const { ready, unavailable } = yield* mediaProviders();
    const live = ready.find((provider) => provider.media.generateVideo !== undefined);
    const image = ready[0];
    const liveReason =
      unavailable.find((reason) => reason.startsWith("Grok")) ??
      (ready.length > 0 ? "Requires Grok" : "Requires Grok");
    const imageReason = unavailable[0] ?? "No connected provider can generate images";
    return {
      liveAnimation: live
        ? {
            available: true,
            providerInstanceId: live.instance.instanceId,
            providerName: live.name,
          }
        : { available: false, reason: liveReason },
      image: image
        ? {
            available: true,
            providerInstanceId: image.instance.instanceId,
            providerName: image.name,
          }
        : { available: false, reason: imageReason },
    };
  }).pipe(Effect.mapError(storage()));

  const requireProvider = Effect.fn("BotAvatarService.requireProvider")(function* (
    need: "image" | "video",
    projectId: ProjectId,
  ) {
    const { ready, unavailable } = yield* mediaProviders().pipe(
      Effect.mapError(storage(projectId)),
    );
    const provider =
      need === "video"
        ? ready.find((candidate) => candidate.media.generateVideo !== undefined)
        : ready[0];
    if (provider) return provider;
    return yield* new BotAvatarError({
      reason: "provider-unavailable",
      projectId,
      ...(unavailable[0] === undefined
        ? need === "video"
          ? { providerMessage: "Live animation needs a connected Grok account." }
          : {}
        : { providerMessage: `${unavailable[0]}.` }),
    });
  });

  const avatarRoot = (project: Pick<Project, "workspaceRoot">) =>
    path.join(project.workspaceRoot, AVATAR_FOLDER);
  const workDir = (project: Project, version: string) =>
    path.join(avatarRoot(project), "work", version);

  /** Copies a generated file into the content-addressed store; clips lose their audio here. */
  const storeAsset = Effect.fn("BotAvatarService.storeAsset")(function* (
    project: Project,
    sourcePath: string,
    kind: "image" | "video",
  ) {
    const info = yield* fs.stat(sourcePath).pipe(Effect.mapError(storage(project.id)));
    if (Number(info.size) > BOT_AVATAR_ASSET_MAX_BYTES) {
      return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
    }
    const raw = yield* fs.readFile(sourcePath).pipe(Effect.mapError(storage(project.id)));
    let bytes = raw;
    let extension: string;
    if (kind === "video") {
      if (!isMp4(raw)) {
        return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
      }
      const stripped = stripMp4AudioTracks(raw);
      if (stripped.videoTracks === 0) {
        return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
      }
      bytes = stripped.bytes;
      extension = "mp4";
    } else {
      const sniffed = sniffImageExtension(raw);
      if (sniffed === null) {
        return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
      }
      extension = sniffed;
    }
    const digest = yield* crypto
      .digest("SHA-256", bytes)
      .pipe(Effect.map(Hex.encode), Effect.mapError(storage(project.id)));
    const relativePath = `${AVATAR_FOLDER}/${digest}.${extension}`;
    yield* fs
      .makeDirectory(avatarRoot(project), { recursive: true })
      .pipe(Effect.mapError(storage(project.id)));
    yield* fs.writeFile(path.join(project.workspaceRoot, relativePath), bytes, { flag: "wx" }).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => Effect.void,
      ),
      Effect.mapError(storage(project.id)),
    );
    if (!isAssetPath(relativePath)) {
      return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
    }
    return relativePath;
  });

  /**
   * Every write re-reads the project and checks the version it was started for, so a job that
   * outlived a newer choice can never overwrite it.
   */
  const write = Effect.fn("BotAvatarService.write")(function* (input: {
    readonly projectId: ProjectId;
    readonly commandId: CommandId;
    readonly expectVersion: string | null;
    readonly patch: (current: Project) => {
      readonly botAvatar: BotAvatar | null;
      readonly faviconPath?: string | null;
      readonly projectIcon?: null;
    };
  }) {
    return yield* locks.withLock(
      input.projectId,
      Effect.gen(function* () {
        const current = yield* readBot(input.projectId);
        if (input.expectVersion !== null && current.botAvatar?.version !== input.expectVersion) {
          return yield* new BotAvatarError({ reason: "stale", projectId: input.projectId });
        }
        const next = input.patch(current);
        return yield* projects
          .update({
            commandId: input.commandId,
            projectId: input.projectId,
            botAvatar: next.botAvatar,
            ...(next.faviconPath === undefined ? {} : { faviconPath: next.faviconPath }),
            ...(next.projectIcon === undefined ? {} : { projectIcon: next.projectIcon }),
          })
          .pipe(Effect.mapError(storage(input.projectId)));
      }),
    );
  });

  const jobCommandId = (version: string, step: string) =>
    CommandId.make(`bot-avatar:${version}:${step}`);

  const failJob = Effect.fn("BotAvatarService.failJob")(
    function* (
      projectId: ProjectId,
      version: string,
      step: NonNullable<BotAvatarJob["failedStep"]>,
      error: BotAvatarError,
    ) {
      const at = yield* now;
      yield* write({
        projectId,
        commandId: jobCommandId(version, `failed:${step}:${at}`),
        expectVersion: version,
        patch: (current) => ({
          botAvatar: {
            version,
            clips: current.botAvatar?.clips ?? {},
            updatedAt: at,
            job:
              current.botAvatar?.job === null || current.botAvatar?.job === undefined
                ? null
                : {
                    ...current.botAvatar.job,
                    status: "failed",
                    failedStep: step,
                    error: botAvatarErrorMessage(error.reason, error.providerMessage),
                  },
          },
        }),
      });
    },
    (effect) => Effect.ignore(effect),
  );

  const launch = Effect.fn("BotAvatarService.launch")(function* (
    projectId: ProjectId,
    version: string,
    job: Effect.Effect<void, never>,
  ) {
    yield* launchLocks.withLock(
      projectId,
      Effect.gen(function* () {
        // A newer request may have committed while this request was preparing its job.
        const current = yield* readBot(projectId);
        if (current.botAvatar?.version !== version || current.botAvatar.job === null) return;
        const previous = jobs.get(projectId);
        if (previous) yield* Fiber.interrupt(previous.fiber);
        const fiber = yield* job.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (jobs.get(projectId)?.version === version) jobs.delete(projectId);
            }),
          ),
          Effect.forkIn(jobScope),
        );
        jobs.set(projectId, { version, fiber });
      }),
    );
  });

  const runOptions = Effect.fn("BotAvatarService.runOptions")(
    function* (project: Project, version: string, prompt: string, provider: MediaProvider) {
      const cwd = workDir(project, version);
      yield* fs.makeDirectory(cwd, { recursive: true }).pipe(Effect.mapError(storage(project.id)));
      const generated = yield* provider.media
        .generateImages({
          cwd,
          prompts: botAvatarCandidatePrompts(prompt).slice(0, CANDIDATE_COUNT),
          aspectRatio: "1:1",
        })
        .pipe(Effect.mapError(fromMediaError));
      const candidates: Array<BotAvatarAssetPath> = [];
      for (const source of generated.paths) {
        if (source === null) continue;
        const stored = yield* storeAsset(project, source, "image").pipe(
          Effect.orElseSucceed(() => null),
        );
        if (stored !== null && !candidates.includes(stored)) candidates.push(stored);
      }
      if (candidates.length === 0) {
        return yield* new BotAvatarError({ reason: "generation-failed", projectId: project.id });
      }
      const at = yield* now;
      yield* write({
        projectId: project.id,
        commandId: jobCommandId(version, "options"),
        expectVersion: version,
        patch: (current) => ({
          botAvatar: {
            version,
            clips: {},
            updatedAt: at,
            job: {
              kind: "live",
              status: "awaiting-selection",
              prompt,
              candidates,
              startedAt: current.botAvatar?.job?.startedAt ?? at,
            },
          },
        }),
      });
    },
    (effect, project, version) =>
      effect.pipe(
        Effect.catch((error) =>
          error.reason === "stale" ? Effect.void : failJob(project.id, version, "options", error),
        ),
      ),
  );

  const runAnimation = Effect.fn("BotAvatarService.runAnimation")(
    function* (
      project: Project,
      version: string,
      still: string,
      missing: ReadonlyArray<BotAvatarClipKind>,
      provider: MediaProvider,
    ) {
      const generateVideo = provider.media.generateVideo;
      if (generateVideo === undefined) {
        return yield* new BotAvatarError({ reason: "provider-unavailable", projectId: project.id });
      }
      const cwd = workDir(project, version);
      yield* fs.makeDirectory(cwd, { recursive: true }).pipe(Effect.mapError(storage(project.id)));
      const reference = path.join(project.workspaceRoot, still);
      const outcomes = yield* Effect.forEach(
        missing,
        (kind) =>
          Effect.gen(function* () {
            const clip = yield* generateVideo({
              cwd,
              prompt: botAvatarClipPrompt(kind),
              referenceImagePath: reference,
              pinReferencePose: kind === "idle",
              durationSeconds: 6,
              resolution: "480p",
              aspectRatio: "1:1",
            }).pipe(Effect.mapError(fromMediaError));
            const stored = yield* storeAsset(project, clip.path, "video");
            const at = yield* now;
            // Clips land one at a time so the client can start the first while others render.
            yield* write({
              projectId: project.id,
              commandId: jobCommandId(version, `clip:${kind}`),
              expectVersion: version,
              patch: (current) => ({
                botAvatar: {
                  version,
                  clips: { ...current.botAvatar?.clips, [kind]: stored },
                  updatedAt: at,
                  job: current.botAvatar?.job ?? null,
                },
              }),
            });
          }).pipe(Effect.result),
        { concurrency: missing.length || 1 },
      );
      const failure = outcomes.find((outcome) => outcome._tag === "Failure");
      if (failure !== undefined && failure._tag === "Failure") return yield* failure.failure;
      const at = yield* now;
      yield* write({
        projectId: project.id,
        commandId: jobCommandId(version, "ready"),
        expectVersion: version,
        patch: (current) => ({
          botAvatar: { version, clips: current.botAvatar?.clips ?? {}, updatedAt: at, job: null },
        }),
      });
    },
    (effect, project, version) =>
      effect.pipe(
        Effect.catch((error) =>
          error.reason === "stale" ? Effect.void : failJob(project.id, version, "animation", error),
        ),
      ),
  );

  const runImage = Effect.fn("BotAvatarService.runImage")(
    function* (project: Project, version: string, prompt: string, provider: MediaProvider) {
      const cwd = workDir(project, version);
      yield* fs.makeDirectory(cwd, { recursive: true }).pipe(Effect.mapError(storage(project.id)));
      const generated = yield* provider.media
        .generateImages({ cwd, prompts: [botAvatarImagePrompt(prompt)], aspectRatio: "1:1" })
        .pipe(Effect.mapError(fromMediaError));
      const source = generated.paths[0];
      if (source === null || source === undefined) {
        return yield* new BotAvatarError({ reason: "generation-failed", projectId: project.id });
      }
      const stored = yield* storeAsset(project, source, "image");
      const at = yield* now;
      yield* write({
        projectId: project.id,
        commandId: jobCommandId(version, "image"),
        expectVersion: version,
        patch: () => ({
          faviconPath: stored,
          projectIcon: null,
          botAvatar: { version, clips: {}, updatedAt: at, job: null },
        }),
      });
    },
    (effect, project, version) =>
      effect.pipe(
        Effect.catch((error) =>
          error.reason === "stale" ? Effect.void : failJob(project.id, version, "image", error),
        ),
      ),
  );

  const generateOptions = Effect.fn("BotAvatarService.generateOptions")(function* (
    input: BotAvatarGenerateOptionsInput,
  ) {
    const project = yield* readBot(input.projectId);
    const provider = yield* requireProvider("video", project.id);
    const version = yield* newVersion;
    const at = yield* now;
    const updated = yield* write({
      projectId: project.id,
      commandId: input.commandId,
      expectVersion: null,
      patch: () => ({
        botAvatar: {
          version,
          clips: {},
          updatedAt: at,
          job: { kind: "live", status: "generating-options", prompt: input.prompt, startedAt: at },
        },
      }),
    });
    yield* launch(project.id, version, runOptions(updated, version, input.prompt, provider));
    return updated;
  });

  const selectOption = Effect.fn("BotAvatarService.selectOption")(function* (
    input: BotAvatarSelectOptionInput,
  ) {
    const project = yield* readBot(input.projectId);
    const job = project.botAvatar?.job;
    if (project.botAvatar?.version !== input.version || !job || job.kind !== "live") {
      return yield* new BotAvatarError({ reason: "stale", projectId: project.id });
    }
    if (!job.candidates?.includes(input.candidate)) {
      return yield* new BotAvatarError({ reason: "invalid-selection", projectId: project.id });
    }
    const exists = yield* fs
      .exists(path.join(project.workspaceRoot, input.candidate))
      .pipe(Effect.mapError(storage(project.id)));
    if (!exists) {
      return yield* new BotAvatarError({ reason: "invalid-selection", projectId: project.id });
    }
    const provider = yield* requireProvider("video", project.id);
    const at = yield* now;
    const version = yield* newVersion;
    // The still is the avatar from this moment; clips arrive behind it.
    const updated = yield* write({
      projectId: project.id,
      commandId: input.commandId,
      expectVersion: input.version,
      patch: () => ({
        faviconPath: input.candidate,
        projectIcon: null,
        botAvatar: {
          version,
          clips: {},
          updatedAt: at,
          job: { ...job, status: "animating", error: undefined, failedStep: undefined },
        },
      }),
    });
    yield* launch(
      project.id,
      version,
      runAnimation(updated, version, input.candidate, BOT_AVATAR_CLIP_KINDS, provider),
    );
    return updated;
  });

  const describeImage = Effect.fn("BotAvatarService.describeImage")(function* (
    input: BotAvatarDescribeImageInput,
  ) {
    const project = yield* readBot(input.projectId);
    const provider = yield* requireProvider("image", project.id);
    const version = yield* newVersion;
    const at = yield* now;
    const updated = yield* write({
      projectId: project.id,
      commandId: input.commandId,
      expectVersion: null,
      patch: () => ({
        botAvatar: {
          version,
          clips: {},
          updatedAt: at,
          job: { kind: "image", status: "generating-image", prompt: input.prompt, startedAt: at },
        },
      }),
    });
    yield* launch(project.id, version, runImage(updated, version, input.prompt, provider));
    return updated;
  });

  const retry = Effect.fn("BotAvatarService.retry")(function* (input: BotAvatarRetryInput) {
    const project = yield* readBot(input.projectId);
    const avatar = project.botAvatar;
    const job = avatar?.job;
    if (!avatar || avatar.version !== input.version || !job || job.status !== "failed") {
      return yield* new BotAvatarError({ reason: "stale", projectId: project.id });
    }
    const step = job.failedStep ?? (job.kind === "image" ? "image" : "options");
    const provider = yield* requireProvider(
      step === "animation" ? "video" : step === "options" ? "video" : "image",
      project.id,
    );
    const at = yield* now;
    const version = yield* newVersion;
    if (step === "animation") {
      const still = project.faviconPath;
      if (!still || !isAssetPath(still)) {
        return yield* new BotAvatarError({ reason: "invalid-selection", projectId: project.id });
      }
      const missing = BOT_AVATAR_CLIP_KINDS.filter((kind) => avatar.clips[kind] === undefined);
      const updated = yield* write({
        projectId: project.id,
        commandId: input.commandId,
        expectVersion: input.version,
        patch: () => ({
          botAvatar: {
            ...avatar,
            version,
            updatedAt: at,
            job: { ...job, status: "animating", error: undefined, failedStep: undefined },
          },
        }),
      });
      yield* launch(project.id, version, runAnimation(updated, version, still, missing, provider));
      return updated;
    }
    const status = step === "image" ? "generating-image" : "generating-options";
    const updated = yield* write({
      projectId: project.id,
      commandId: input.commandId,
      expectVersion: input.version,
      patch: () => ({
        botAvatar: {
          ...avatar,
          version,
          updatedAt: at,
          job: { ...job, status, candidates: undefined, error: undefined, failedStep: undefined },
        },
      }),
    });
    yield* launch(
      project.id,
      version,
      step === "image"
        ? runImage(updated, version, job.prompt, provider)
        : runOptions(updated, version, job.prompt, provider),
    );
    return updated;
  });

  const dismiss = Effect.fn("BotAvatarService.dismiss")(function* (input: BotAvatarDismissInput) {
    const project = yield* readBot(input.projectId);
    const avatar = project.botAvatar;
    if (!avatar || avatar.job === null) return project;
    const running = jobs.get(project.id);
    if (running) {
      yield* Fiber.interrupt(running.fiber);
      if (jobs.get(project.id) === running) jobs.delete(project.id);
    }
    const at = yield* now;
    return yield* write({
      projectId: project.id,
      commandId: input.commandId,
      expectVersion: avatar.version,
      patch: (current) => ({
        botAvatar: { ...avatar, clips: current.botAvatar?.clips ?? {}, updatedAt: at, job: null },
      }),
    });
  });

  const listAssets = Effect.fn("BotAvatarService.listAssets")(function* (projectId: ProjectId) {
    const project = yield* readBot(projectId);
    const entries = yield* fs.readDirectory(avatarRoot(project)).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed([] as ReadonlyArray<string>),
      ),
      Effect.mapError(storage(projectId)),
    );
    return entries
      .map((entry) => `${AVATAR_FOLDER}/${entry}`)
      .filter((entry): entry is BotAvatarAssetPath => isAssetPath(entry))
      .sort();
  });

  const assetRead = Effect.fn("BotAvatarService.assetRead")(function* (
    input: BotAvatarAssetReadInput,
  ) {
    const project = yield* readBot(input.projectId);
    const bytes = yield* fs
      .readFile(path.join(project.workspaceRoot, input.path))
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "NotFound"
            ? new BotAvatarError({ reason: "not-found", projectId: project.id })
            : storage(project.id)(error),
        ),
      );
    if (bytes.length > BOT_AVATAR_ASSET_MAX_BYTES) {
      return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
    }
    return { projectId: project.id, path: input.path, base64: Base64.encode(bytes) };
  });

  const assetReceive = Effect.fn("BotAvatarService.assetReceive")(function* (
    input: BotAvatarAssetTransfer,
  ) {
    const existing = yield* projects
      .getById(input.projectId)
      .pipe(Effect.mapError(storage(input.projectId)));
    if (Option.isSome(existing) && existing.value.botRole == null) {
      return yield* new BotAvatarError({ reason: "not-found", projectId: input.projectId });
    }
    // Files arrive before the manifest creates a new replica. Both paths must use the same
    // managed workspace, without publishing a half-created bot merely to receive its assets.
    const workspaceRoot = Option.isSome(existing)
      ? existing.value.workspaceRoot
      : yield* folders
          .prepareBotWorkspace(input.projectId)
          .pipe(Effect.mapError(storage(input.projectId)));
    const project = { id: input.projectId, workspaceRoot };
    const bytes = yield* Effect.fromResult(Base64.decode(input.base64)).pipe(
      Effect.mapError(() => new BotAvatarError({ reason: "asset-invalid", projectId: project.id })),
    );
    if (bytes.length === 0 || bytes.length > BOT_AVATAR_ASSET_MAX_BYTES) {
      return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
    }
    // The name is the digest: a sender cannot plant a file under another asset's path.
    const digest = yield* crypto
      .digest("SHA-256", bytes)
      .pipe(Effect.map(Hex.encode), Effect.mapError(storage(project.id)));
    const extension = path.extname(input.path).slice(1).toLowerCase();
    const expected = `${AVATAR_FOLDER}/${digest}.${extension}`;
    const typed =
      extension === "mp4"
        ? isMp4(bytes)
        : sniffImageExtension(bytes) === extension.replace("jpeg", "jpg");
    if (expected !== input.path.toLowerCase() || !typed) {
      return yield* new BotAvatarError({ reason: "asset-invalid", projectId: project.id });
    }
    yield* fs
      .makeDirectory(avatarRoot(project), { recursive: true })
      .pipe(Effect.mapError(storage(project.id)));
    yield* fs.writeFile(path.join(project.workspaceRoot, input.path), bytes, { flag: "wx" }).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => Effect.void,
      ),
      Effect.mapError(storage(project.id)),
    );
  });

  const awaitIdle = (projectId: ProjectId) =>
    Effect.suspend(() => {
      const running = jobs.get(projectId);
      return running ? Effect.asVoid(Fiber.await(running.fiber)) : Effect.void;
    });

  // Jobs do not survive a restart. Say so instead of leaving a spinner that never settles.
  yield* Effect.gen(function* () {
    const snapshot = yield* projects.snapshot;
    const at = yield* now;
    for (const project of snapshot.projects) {
      const job = project.botAvatar?.job;
      if (
        !project.botAvatar ||
        !job ||
        job.status === "failed" ||
        job.status === "awaiting-selection"
      )
        continue;
      yield* projects
        .update({
          commandId: CommandId.make(`bot-avatar:${project.botAvatar.version}:restart:${at}`),
          projectId: project.id,
          botAvatar: {
            ...project.botAvatar,
            updatedAt: at,
            job: {
              ...job,
              status: "failed",
              failedStep:
                job.status === "animating"
                  ? "animation"
                  : job.kind === "image"
                    ? "image"
                    : "options",
              error: "T3 Code restarted while this was generating. Retry to continue.",
            },
          },
        })
        .pipe(Effect.ignore);
    }
  }).pipe(Effect.ignore);

  return BotAvatarService.of({
    capabilities,
    generateOptions,
    selectOption,
    describeImage,
    retry,
    dismiss,
    assetRead,
    assetReceive,
    listAssets,
    awaitIdle,
  });
});

export const layer = Layer.effect(BotAvatarService, make);
