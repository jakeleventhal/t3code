import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type BotAvatarAssetPath,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import {
  ProviderMediaGenerationError,
  type ImageGenerationInput,
  type VideoGenerationInput,
} from "@t3tools/provider-core/server/mediaGeneration";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as ProjectEnrichment from "../project/ProjectEnrichmentService.ts";
import * as Favicon from "../project/ProjectFaviconResolver.ts";
import * as Repository from "../project/RepositoryIdentityResolver.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as BotAvatarService from "./BotAvatarService.ts";

const encoder = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function box(type: string, ...children: Array<Uint8Array>): Uint8Array {
  const size = children.reduce((total, child) => total + child.length, 8);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(encoder.encode(type), 4);
  let offset = 8;
  for (const child of children) {
    bytes.set(child, offset);
    offset += child.length;
  }
  return bytes;
}
function trak(handler: string): Uint8Array {
  const hdlr = new Uint8Array(25);
  hdlr.set(encoder.encode(handler), 8);
  return box("trak", box("mdia", box("hdlr", hdlr)));
}
const MP4 = new Uint8Array([
  ...box("ftyp", encoder.encode("isom")),
  ...box("moov", trak("vide"), trak("soun")),
  ...box("mdat", encoder.encode("frames")),
]);

interface FakeMedia {
  readonly images: Ref.Ref<ReadonlyArray<ImageGenerationInput>>;
  readonly videos: Ref.Ref<ReadonlyArray<VideoGenerationInput>>;
  readonly gate: Ref.Ref<Deferred.Deferred<void> | null>;
  readonly failVideo: Ref.Ref<ProviderMediaGenerationError | null>;
  readonly failImages: Ref.Ref<ProviderMediaGenerationError | null>;
}

const makeFake = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fake-imagine-" });
  const fake: FakeMedia = {
    images: yield* Ref.make<ReadonlyArray<ImageGenerationInput>>([]),
    videos: yield* Ref.make<ReadonlyArray<VideoGenerationInput>>([]),
    gate: yield* Ref.make<Deferred.Deferred<void> | null>(null),
    failVideo: yield* Ref.make<ProviderMediaGenerationError | null>(null),
    failImages: yield* Ref.make<ProviderMediaGenerationError | null>(null),
  };
  let counter = 0;
  const waitGate = Effect.gen(function* () {
    const gate = yield* Ref.get(fake.gate);
    if (gate !== null) yield* Deferred.await(gate);
  });
  const instance = {
    instanceId: ProviderInstanceId.make("grok"),
    driverKind: "grok",
    displayName: "Grok",
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed({
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
      }),
    },
    mediaGeneration: {
      generateImages: (input: ImageGenerationInput) =>
        Effect.gen(function* () {
          yield* Ref.update(fake.images, (all) => [...all, input]);
          yield* waitGate;
          const failure = yield* Ref.get(fake.failImages);
          if (failure !== null) return yield* failure;
          const paths: Array<string> = [];
          for (const prompt of input.prompts) {
            counter += 1;
            const file = path.join(outDir, `${counter}.png`);
            // Distinct bytes per prompt so each candidate gets its own digest.
            yield* fs.writeFile(
              file,
              new Uint8Array([...PNG, ...encoder.encode(`${counter}:${prompt}`)]),
            );
            paths.push(file);
          }
          return { paths };
        }),
      generateVideo: (input: VideoGenerationInput) =>
        Effect.gen(function* () {
          yield* Ref.update(fake.videos, (all) => [...all, input]);
          yield* waitGate;
          const failure = yield* Ref.get(fake.failVideo);
          if (failure !== null && input.prompt.includes("headphones")) return yield* failure;
          counter += 1;
          const file = path.join(outDir, `${counter}.mp4`);
          yield* fs.writeFile(
            file,
            new Uint8Array([...MP4, ...encoder.encode(input.prompt.slice(0, 8))]),
          );
          return { path: file };
        }),
    },
  } as unknown as ProviderInstance;
  return { fake, instance };
});

const dependencies = Layer.mergeAll(
  ManagedProjectFolders.layer.pipe(Layer.provide(RuntimeLayer.layerProjectService)),
  RuntimeLayer.layerProjectService,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(
  Layer.provideMerge(ProjectEnrichment.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("avatar-test")),
      }),
      Layer.mock(GitWorkflow.GitWorkflowService)({ isRepository: () => Effect.succeed(false) }),
      Layer.mock(Git.GitVcsDriver)({}),
      Layer.succeed(Repository.RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
      Layer.succeed(Favicon.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: () => Effect.succeed(null),
      }),
      Layer.mock(WorkspacePaths.WorkspacePaths)({ normalizeWorkspaceRoot: Effect.succeed }),
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-bot-avatar-service-" })),
  Layer.provideMerge(NodeServices.layer),
);

const fixture = (instances: ReadonlyArray<ProviderInstance>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const projects = yield* ProjectService.ProjectService;
    const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-bot-avatar-" });
    const projectId = ProjectId.make("bot:avatar-test");
    yield* projects.create({
      commandId: CommandId.make("create-bot"),
      projectId,
      title: "Workouty",
      workspaceRoot,
      botRole: "specialist",
    });
    const registry = Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      listInstances: Effect.succeed(instances),
    });
    // Built into the test's scope: the job scope lives as long as the service does.
    const context = yield* Layer.build(BotAvatarService.layer.pipe(Layer.provide(registry)));
    const service = Context.get(context, BotAvatarService.BotAvatarService);
    const read = projects.getById(projectId).pipe(Effect.map(Option.getOrThrow));
    return { projectId, workspaceRoot, service, read, fs };
  });

let commandSequence = 0;
const command = (name: string) => CommandId.make(`test:${name}:${++commandSequence}`);

describe("BotAvatarService", () => {
  it.effect("reports what each provider can do, honestly", () =>
    Effect.gen(function* () {
      const { instance } = yield* makeFake;
      const none = yield* fixture([]);
      const without = yield* none.service.capabilities;
      assert.equal(without.liveAnimation.available, false);
      assert.equal(without.liveAnimation.reason, "Requires Grok");
      assert.equal(without.image.available, false);
      const withGrok = yield* fixture([instance]);
      const caps = yield* withGrok.service.capabilities;
      assert.equal(caps.liveAnimation.available, true);
      assert.equal(caps.liveAnimation.providerName, "Grok");
      assert.equal(caps.image.available, true);
      const refused = yield* none.service
        .generateOptions({ commandId: command("go"), projectId: none.projectId, prompt: "a cat" })
        .pipe(Effect.flip);
      assert.equal(refused.reason, "provider-unavailable");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect(
    "generates four options, applies the chosen still at once, then animates silently",
    () =>
      Effect.gen(function* () {
        const { fake, instance } = yield* makeFake;
        const { projectId, workspaceRoot, service, read, fs } = yield* fixture([instance]);
        const started = yield* service.generateOptions({
          commandId: command("options"),
          projectId,
          prompt: "a chubby white cat",
        });
        assert.equal(started.botAvatar?.job?.status, "generating-options");
        yield* service.awaitIdle(projectId);
        const ready = yield* read;
        const job = ready.botAvatar?.job;
        assert.equal(job?.status, "awaiting-selection");
        assert.isTrue(ready.botAvatar!.updatedAt > started.botAvatar!.updatedAt);
        assert.equal(job?.candidates?.length, 4);
        assert.equal((yield* Ref.get(fake.images))[0]?.prompts.length, 4);
        assert.ok((yield* Ref.get(fake.images))[0]?.prompts[0]?.includes("a chubby white cat"));
        // Nothing changed on the face yet: picking is the user's.
        assert.equal(ready.faviconPath ?? null, null);

        const version = ready.botAvatar!.version;
        const candidate = job!.candidates![1]!;
        const selected = yield* service.selectOption({
          commandId: command("select"),
          projectId,
          version,
          candidate,
        });
        assert.equal(selected.faviconPath, candidate);
        assert.equal(selected.projectIcon ?? null, null);
        assert.equal(selected.botAvatar?.job?.status, "animating");
        yield* service.awaitIdle(projectId);
        const done = yield* read;
        assert.equal(done.botAvatar?.job, null);
        assert.isTrue(done.botAvatar!.updatedAt > selected.botAvatar!.updatedAt);
        assert.deepEqual(Object.keys(done.botAvatar!.clips).sort(), ["call", "idle", "working"]);
        assert.notEqual(done.botAvatar?.version, version);
        assert.equal(done.botAvatar?.version, selected.botAvatar?.version);
        const videos = yield* Ref.get(fake.videos);
        assert.equal(videos.length, 3);
        assert.ok(videos.every((video) => video.referenceImagePath.endsWith(candidate)));
        assert.ok(
          videos.every((video) => video.durationSeconds === 6 && video.resolution === "480p"),
        );
        // Stored clips carry no audio track: the soun trak box was renamed to free.
        const stored = yield* fs.readFile(`${workspaceRoot}/${done.botAvatar!.clips.idle!}`);
        const text = new TextDecoder("latin1").decode(stored);
        assert.equal(text.split("trak").length - 1, 1);
        assert.ok(text.includes("free"));
        assert.ok(done.botAvatar!.clips.idle!.startsWith(".avatars/"));
      }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("a newer choice cancels the older job and its results never land", () =>
    Effect.gen(function* () {
      const { fake, instance } = yield* makeFake;
      const { projectId, service, read } = yield* fixture([instance]);
      const gate = yield* Deferred.make<void>();
      yield* Ref.set(fake.gate, gate);
      yield* service.generateOptions({ commandId: command("first"), projectId, prompt: "a cat" });
      const second = yield* service.describeImage({
        commandId: command("second"),
        projectId,
        prompt: "a brass robot",
      });
      assert.equal(second.botAvatar?.job?.status, "generating-image");
      yield* Ref.set(fake.gate, null);
      yield* Deferred.succeed(gate, undefined);
      yield* service.awaitIdle(projectId);
      const final = yield* read;
      assert.equal(final.botAvatar?.version, second.botAvatar?.version);
      assert.equal(final.botAvatar?.job, null);
      assert.ok(final.faviconPath?.startsWith(".avatars/"));
      // The first job's candidates were never written.
      assert.equal(final.botAvatar?.clips.idle, undefined);
      const stale = yield* service
        .selectOption({
          commandId: command("stale"),
          projectId,
          version: "not-the-version",
          candidate: final.faviconPath as BotAvatarAssetPath,
        })
        .pipe(Effect.flip);
      assert.equal(stale.reason, "stale");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("reselecting during animation starts a new version and rejects stale selections", () =>
    Effect.gen(function* () {
      const { fake, instance } = yield* makeFake;
      const { projectId, service, read } = yield* fixture([instance]);
      yield* service.generateOptions({
        commandId: command("options"),
        projectId,
        prompt: "a cloud",
      });
      yield* service.awaitIdle(projectId);
      const options = (yield* read).botAvatar!;
      const gate = yield* Deferred.make<void>();
      yield* Ref.set(fake.gate, gate);
      const first = yield* service.selectOption({
        commandId: command("first"),
        projectId,
        version: options.version,
        candidate: options.job!.candidates![0]!,
      });
      const secondCandidate = options.job!.candidates![1]!;
      const second = yield* service.selectOption({
        commandId: command("second"),
        projectId,
        version: first.botAvatar!.version,
        candidate: secondCandidate,
      });
      assert.notEqual(first.botAvatar!.version, second.botAvatar!.version);
      const stale = yield* service
        .selectOption({
          commandId: command("late"),
          projectId,
          version: first.botAvatar!.version,
          candidate: options.job!.candidates![2]!,
        })
        .pipe(Effect.flip);
      assert.equal(stale.reason, "stale");
      yield* Ref.set(fake.gate, null);
      yield* Deferred.succeed(gate, undefined);
      yield* service.awaitIdle(projectId);
      const result = yield* read;
      assert.equal(result.faviconPath, secondCandidate);
      assert.equal(result.botAvatar!.version, second.botAvatar!.version);
      assert.equal(result.botAvatar!.job, null);
      assert.deepEqual(Object.keys(result.botAvatar!.clips).sort(), ["call", "idle", "working"]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect(
    "a refused clip keeps the still, explains why, and retry finishes the missing clips",
    () =>
      Effect.gen(function* () {
        const { fake, instance } = yield* makeFake;
        const { projectId, service, read } = yield* fixture([instance]);
        yield* service.generateOptions({ commandId: command("o"), projectId, prompt: "an owl" });
        yield* service.awaitIdle(projectId);
        const options = yield* read;
        yield* Ref.set(
          fake.failVideo,
          new ProviderMediaGenerationError({
            operation: "generateVideo",
            reason: "quota",
            providerMessage: "You have run out of credits or need a Grok subscription.",
          }),
        );
        yield* service.selectOption({
          commandId: command("s"),
          projectId,
          version: options.botAvatar!.version,
          candidate: options.botAvatar!.job!.candidates![0]!,
        });
        yield* service.awaitIdle(projectId);
        const failed = yield* read;
        assert.equal(failed.botAvatar?.job?.status, "failed");
        assert.equal(failed.botAvatar?.job?.failedStep, "animation");
        assert.ok(failed.botAvatar?.job?.error?.includes("run out of credits"));
        assert.equal(failed.faviconPath, options.botAvatar!.job!.candidates![0]);
        // Idle and call rendered; only working was refused.
        assert.deepEqual(Object.keys(failed.botAvatar!.clips).sort(), ["call", "idle"]);

        yield* Ref.set(fake.failVideo, null);
        const retried = yield* service.retry({
          commandId: command("r"),
          projectId,
          version: failed.botAvatar!.version,
        });
        assert.equal(retried.botAvatar?.job?.status, "animating");
        yield* service.awaitIdle(projectId);
        const done = yield* read;
        assert.equal(done.botAvatar?.job, null);
        assert.deepEqual(Object.keys(done.botAvatar!.clips).sort(), ["call", "idle", "working"]);
        // Retry only asked for the missing clip.
        assert.equal((yield* Ref.get(fake.videos)).length, 4);
      }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("dismiss drops a failed step and keeps what was finished", () =>
    Effect.gen(function* () {
      const { fake, instance } = yield* makeFake;
      const { projectId, service, read } = yield* fixture([instance]);
      yield* Ref.set(
        fake.failImages,
        new ProviderMediaGenerationError({ operation: "generateImages", reason: "privacy" }),
      );
      yield* service.describeImage({ commandId: command("d"), projectId, prompt: "a fox" });
      yield* service.awaitIdle(projectId);
      const failed = yield* read;
      assert.equal(failed.botAvatar?.job?.status, "failed");
      assert.equal(failed.botAvatar?.job?.failedStep, "image");
      assert.ok(failed.botAvatar?.job?.error?.includes("privacy settings"));
      const dismissed = yield* service.dismiss({ commandId: command("x"), projectId });
      assert.equal(dismissed.botAvatar?.job, null);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("assets move between environments by digest and reject forged names", () =>
    Effect.gen(function* () {
      const { instance } = yield* makeFake;
      const { projectId, service, read } = yield* fixture([instance]);
      yield* service.describeImage({ commandId: command("i"), projectId, prompt: "a fox" });
      yield* service.awaitIdle(projectId);
      const still = (yield* read).faviconPath as BotAvatarAssetPath;
      const listed = yield* service.listAssets(projectId);
      assert.deepEqual(listed, [still]);
      const transfer = yield* service.assetRead({ projectId, path: still });
      assert.equal(transfer.path, still);
      // Receiving the same content again is idempotent.
      yield* service.assetReceive(transfer);
      const replicaId = ProjectId.make("new-avatar-replica");
      yield* service.assetReceive({ ...transfer, projectId: replicaId });
      const projects = yield* ProjectService.ProjectService;
      assert.isTrue(Option.isNone(yield* projects.getById(replicaId)));
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const replicaRoot = yield* folders.prepareBotWorkspace(replicaId);
      yield* projects.create({
        commandId: command("replica-created-after-assets"),
        projectId: replicaId,
        title: "Replica",
        workspaceRoot: replicaRoot,
        botRole: "specialist",
      });
      assert.deepEqual(yield* service.assetRead({ projectId: replicaId, path: still }), {
        ...transfer,
        projectId: replicaId,
      });
      const forged = yield* service
        .assetReceive({
          ...transfer,
          path: ".avatars/0000000000000000000000000000000000000000000000000000000000000000.png",
        })
        .pipe(Effect.flip);
      assert.equal(forged.reason, "asset-invalid");
      const missing = yield* service
        .assetRead({
          projectId,
          path: ".avatars/1111111111111111111111111111111111111111111111111111111111111111.mp4",
        })
        .pipe(Effect.flip);
      assert.equal(missing.reason, "not-found");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );
});

it.effect("restarting a replica does not fail a job owned by another environment", () =>
  Effect.gen(function* () {
    const { instance } = yield* makeFake;
    const { projectId, read } = yield* fixture([instance]);
    const remote = {
      version: "remote-job",
      clips: {},
      updatedAt: "2026-10-26T20:00:00.000Z",
      job: {
        kind: "live" as const,
        status: "generating-options" as const,
        prompt: "A cloud",
        startedAt: "2026-10-26T20:00:00.000Z",
        originEnvironmentId: EnvironmentId.make("remote"),
      },
    };
    yield* (yield* ProjectService.ProjectService).update({
      commandId: command("remote"),
      projectId,
      botAvatar: remote,
    });
    yield* Layer.build(
      BotAvatarService.layer.pipe(
        Layer.provide(
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            listInstances: Effect.succeed([instance]),
          }),
        ),
      ),
    );
    assert.deepEqual((yield* read).botAvatar, remote);
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
