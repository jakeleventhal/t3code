import {
  AuthEnvironmentMaintainScope,
  AuthPreviewOperateScope,
  AuthDiagnosticsReadScope,
  AuthFilesystemReadScope,
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  ThreadId,
  RunId,
  MessageId,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSourceControlWriteScope,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/rpc/RpcTest";

import {
  RPC_REQUIRED_SCOPES,
  requiredScopeForRpcMethod,
  requiredScopeForDeviceList,
} from "./RpcAuthorization.ts";
import * as RpcAuthorization from "./RpcAuthorization.ts";

describe("RPC authorization scopes", () => {
  it("separates bot profile reads from avatar writes", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.botsFiles)).toBe(AuthOrchestrationReadScope);
    expect(requiredScopeForRpcMethod(WS_METHODS.botsSetAvatar)).toBe(AuthOrchestrationOperateScope);
  });
  it("declares exactly one scope for every RPC in the server group", () => {
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it("keeps webhook delivery logs, which hold request bodies, behind operate scope", () => {
    for (const method of [
      WS_METHODS.scheduledTasksListWebhookDeliveries,
      WS_METHODS.scheduledTasksGetWebhookDelivery,
      WS_METHODS.scheduledTasksRotateWebhookToken,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    }
  });

  it("separates preview control from observation", () => {
    for (const method of [
      WS_METHODS.previewOpen,
      WS_METHODS.previewNavigate,
      WS_METHODS.previewResize,
      WS_METHODS.previewRefresh,
      WS_METHODS.previewClose,
      WS_METHODS.previewReadPage,
      WS_METHODS.previewReportStatus,
      WS_METHODS.previewAdjust,
      WS_METHODS.previewClearProfile,
      WS_METHODS.previewReportProfiles,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthPreviewOperateScope);
    }
    for (const method of [
      WS_METHODS.previewList,
      WS_METHODS.subscribePreviewEvents,
      WS_METHODS.subscribeDiscoveredLocalServers,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    }
  });

  it("separates passive terminal observation from operations that can change a shell", () => {
    for (const method of [
      WS_METHODS.terminalObserve,
      WS_METHODS.subscribeTerminalEvents,
      WS_METHODS.subscribeTerminalMetadata,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthTerminalReadScope);
    }
    for (const method of [
      WS_METHODS.terminalAttach,
      WS_METHODS.terminalOpen,
      WS_METHODS.terminalWrite,
      WS_METHODS.terminalResize,
      WS_METHODS.terminalClear,
      WS_METHODS.terminalRestart,
      WS_METHODS.terminalClose,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthTerminalOperateScope);
    }
  });

  it("rejects unknown RPC method names", () => {
    for (const method of ["server.notRegistered", "toString", "constructor"]) {
      expect(() => requiredScopeForRpcMethod(method)).toThrow(
        `RPC method ${method} has no declared authorization scope.`,
      );
    }
  });
});

it("requires operate permission for host retry while preserving read-only listing", () => {
  expect(requiredScopeForDeviceList({})).toBe(AuthOrchestrationReadScope);
  expect(requiredScopeForDeviceList({ retryHostId: "remote-host" })).toBe(
    AuthOrchestrationOperateScope,
  );
});

it("requires operate permission for tool updates even alongside a read-only check", () => {
  expect(requiredScopeForDeviceList({ updateTool: "agent", inspectOnly: true })).toBe(
    AuthOrchestrationOperateScope,
  );
  expect(requiredScopeForDeviceList({ updateTool: "hub" })).toBe(AuthOrchestrationOperateScope);
});

describe("RPC scope middleware", () => {
  it.effect("read-only clients can read call history but cannot create, append, or end calls", () =>
    Effect.gen(function* () {
      const methods = [
        WS_METHODS.botsVoiceTranscript,
        WS_METHODS.botsVoiceBegin,
        WS_METHODS.botsVoiceConnect,
        WS_METHODS.botsVoiceWork,
        WS_METHODS.botsVoiceAppend,
        WS_METHODS.botsVoiceEnd,
      ] as const;
      const voiceGroup = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, (typeof methods)[number]> =>
            !(methods as ReadonlyArray<string>).includes(tag),
        ),
      );
      let writes = 0;
      const client = yield* RpcTest.makeClient(voiceGroup).pipe(
        Effect.provide(
          Layer.mergeAll(
            voiceGroup.toLayerHandler(WS_METHODS.botsVoiceTranscript, () =>
              Effect.succeed({ entries: [], nextOrdinal: null }),
            ),
            voiceGroup.toLayerHandler(WS_METHODS.botsVoiceBegin, (input) =>
              Effect.sync(() => {
                writes++;
                return {
                  callId: input.callId,
                  botTitle: "Assistant",
                  startedAt: "2026-10-24T00:00:00Z",
                  endedAt: null,
                  endReason: null,
                };
              }),
            ),
            voiceGroup.toLayerHandler(WS_METHODS.botsVoiceAppend, () =>
              Effect.sync(() => {
                writes++;
              }),
            ),
            voiceGroup.toLayerHandler(WS_METHODS.botsVoiceConnect, () =>
              Effect.sync(() => {
                writes++;
                return { kind: "openai-live" as const, sessionId: "session", sdp: "answer" };
              }),
            ),
            voiceGroup.toLayerHandler(WS_METHODS.botsVoiceWork, (input) =>
              Effect.sync(() => {
                writes++;
                return {
                  threadId: input.threadId,
                  runId: RunId.make("work"),
                  messageId: MessageId.make("work"),
                };
              }),
            ),
            voiceGroup.toLayerHandler(WS_METHODS.botsVoiceEnd, () =>
              Effect.sync(() => {
                writes++;
              }),
            ),
            RpcAuthorization.layer([AuthOrchestrationReadScope]),
          ),
        ),
      );
      const input = {
        threadId: ThreadId.make("voice-thread"),
        callId: "call",
        endpointId: "endpoint",
      };
      expect(yield* client[WS_METHODS.botsVoiceTranscript](input)).toEqual({
        entries: [],
        nextOrdinal: null,
      });
      const errors = [
        yield* client[WS_METHODS.botsVoiceBegin](input).pipe(Effect.flip),
        yield* client[WS_METHODS.botsVoiceWork]({
          ...input,
          requestId: "delegation",
          text: "Check this",
        }).pipe(Effect.flip),
        yield* client[WS_METHODS.botsVoiceConnect]({
          ...input,
          transport: { type: "webrtc", sdp: "offer" },
        }).pipe(Effect.flip),
        yield* client[WS_METHODS.botsVoiceAppend]({ ...input, entries: [] }).pipe(Effect.flip),
        yield* client[WS_METHODS.botsVoiceEnd]({ ...input, reason: "user" }).pipe(Effect.flip),
      ];
      for (const error of errors)
        expect(error).toMatchObject({ requiredPermission: AuthOrchestrationOperateScope });
      expect(writes).toBe(0);
    }).pipe(Effect.scoped),
  );
  const tested = [WS_METHODS.serverProbe, WS_METHODS.serverRetryResourceTelemetry] as const;
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, (typeof tested)[number]> =>
        !(tested as ReadonlyArray<string>).includes(tag),
    ),
  );

  it.effect.each([
    { scopes: [AuthOrchestrationReadScope], missing: AuthEnvironmentMaintainScope },
    {
      scopes: [AuthOrchestrationReadScope, AuthEnvironmentMaintainScope],
      missing: AuthDiagnosticsReadScope,
    },
  ])("rejects telemetry retry without $missing before its handler runs", ({ scopes, missing }) =>
    Effect.gen(function* () {
      const handled: Array<string> = [];
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
            group.toLayerHandler(WS_METHODS.serverRetryResourceTelemetry, () =>
              Effect.sync(() => handled.push("retry")).pipe(Effect.andThen(Effect.never)),
            ),
            RpcAuthorization.layer(scopes),
          ),
        ),
      );

      expect(yield* client[WS_METHODS.serverProbe]({})).toEqual({});
      expect(
        yield* client[WS_METHODS.serverRetryResourceTelemetry]({}).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredPermission: missing,
      });
      expect(handled).toEqual([]);
    }).pipe(Effect.scoped),
  );
});

describe("settings mutation authorization", () => {
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (
        tag,
      ): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof WS_METHODS.serverUpdateSettings> =>
        tag !== WS_METHODS.serverUpdateSettings,
    ),
  );
  const providerInstanceMutation = {
    operation: "remove" as const,
    instanceId: ProviderInstanceId.make("codex_work"),
  };

  it.effect("protects voice credentials independently from voice selection", () =>
    Effect.gen(function* () {
      let handled = 0;
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverUpdateSettings, () =>
              Effect.sync(() => {
                handled++;
                return DEFAULT_SERVER_SETTINGS;
              }),
            ),
            RpcAuthorization.layer([AuthSettingsWriteScope]),
          ),
        ),
      );
      yield* client[WS_METHODS.serverUpdateSettings]({
        patch: {
          voiceSelection: { connectionId: "personal", model: "gpt-live-1", voice: "marin" },
        },
      });
      for (const voiceConnections of [
        { personal: null },
        { personal: { kind: "openai-api" as const, name: "Personal", apiKey: "private-test-key" } },
      ]) {
        expect(
          yield* client[WS_METHODS.serverUpdateSettings]({ patch: { voiceConnections } }).pipe(
            Effect.flip,
          ),
        ).toMatchObject({ requiredPermission: AuthProvidersManageScope });
      }
      expect(handled).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("allows provider-only mutations while denying mixed settings without their grant", () =>
    Effect.gen(function* () {
      let handled = 0;
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverUpdateSettings, () =>
              Effect.sync(() => {
                handled++;
                return DEFAULT_SERVER_SETTINGS;
              }),
            ),
            RpcAuthorization.layer([AuthProvidersManageScope]),
          ),
        ),
      );
      yield* client[WS_METHODS.serverUpdateSettings]({ patch: {}, providerInstanceMutation });
      expect(handled).toBe(1);
      expect(
        yield* client[WS_METHODS.serverUpdateSettings]({
          patch: { defaultRuntimeMode: "full-access" },
          providerInstanceMutation,
        }).pipe(Effect.flip),
      ).toMatchObject({ requiredPermission: AuthSettingsWriteScope });
      expect(handled).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("does not let a settings grant create or remove providers", () =>
    Effect.gen(function* () {
      let handled = false;
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverUpdateSettings, () =>
              Effect.sync(() => {
                handled = true;
                return DEFAULT_SERVER_SETTINGS;
              }),
            ),
            RpcAuthorization.layer([AuthSettingsWriteScope]),
          ),
        ),
      );
      expect(
        yield* client[WS_METHODS.serverUpdateSettings]({
          patch: {},
          providerInstanceMutation,
        }).pipe(Effect.flip),
      ).toMatchObject({ requiredPermission: AuthProvidersManageScope });
      expect(handled).toBe(false);
    }).pipe(Effect.scoped),
  );
});

it.effect("requires task permission before attaching a prepared worktree to a thread", () =>
  Effect.gen(function* () {
    const group = WsRpcGroup.omit(
      ...[...WsRpcGroup.requests.keys()].filter(
        (
          tag,
        ): tag is Exclude<
          keyof typeof RPC_REQUIRED_SCOPES,
          typeof WS_METHODS.gitPreparePullRequestThread
        > => tag !== WS_METHODS.gitPreparePullRequestThread,
      ),
    );
    let handled = false;
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(
        Layer.mergeAll(
          group.toLayerHandler(WS_METHODS.gitPreparePullRequestThread, () =>
            Effect.sync(() => {
              handled = true;
            }).pipe(Effect.andThen(Effect.never)),
          ),
          RpcAuthorization.layer([AuthSourceControlWriteScope]),
        ),
      ),
    );
    expect(
      yield* client[WS_METHODS.gitPreparePullRequestThread]({
        cwd: "/repo",
        reference: "42",
        mode: "worktree",
        threadId: ThreadId.make("thread"),
      }).pipe(Effect.flip),
    ).toMatchObject({ requiredPermission: AuthOrchestrationOperateScope });
    expect(handled).toBe(false);
  }).pipe(Effect.scoped),
);

describe("thread context authorization", () => {
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (
        tag,
      ): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof WS_METHODS.gitRunStackedAction> =>
        tag !== WS_METHODS.gitRunStackedAction,
    ),
  );

  it.effect.each(["commit", "create_pr", "commit_push_pr"] as const)(
    "%s needs thread read permission only when generating a PR from a thread",
    (action) =>
      Effect.gen(function* () {
        const handled: string[] = [];
        const handler = group.toLayerHandler(WS_METHODS.gitRunStackedAction, ({ actionId }) =>
          Stream.fromEffect(Effect.sync(() => handled.push(actionId))).pipe(Stream.drain),
        );
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.merge(handler, RpcAuthorization.layer([AuthSourceControlWriteScope])),
          ),
        );
        const input = { actionId: "without-thread", cwd: "/repo", action };
        const withThread = { ...input, actionId: "with-thread", threadId: ThreadId.make("thread") };
        yield* Stream.runDrain(client[WS_METHODS.gitRunStackedAction](input));
        if (action === "create_pr" || action === "commit_push_pr") {
          expect(
            yield* Stream.runDrain(client[WS_METHODS.gitRunStackedAction](withThread)).pipe(
              Effect.flip,
            ),
          ).toMatchObject({ requiredPermission: AuthOrchestrationReadScope });
          expect(handled).toEqual(["without-thread"]);
        } else {
          yield* Stream.runDrain(client[WS_METHODS.gitRunStackedAction](withThread));
          expect(handled).toEqual(["without-thread", "with-thread"]);
        }
        const reader = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.merge(
              handler,
              RpcAuthorization.layer([AuthSourceControlWriteScope, AuthOrchestrationReadScope]),
            ),
          ),
        );
        yield* Stream.runDrain(
          reader[WS_METHODS.gitRunStackedAction]({ ...withThread, actionId: "allowed" }),
        );
        expect(handled.at(-1)).toBe("allowed");
      }).pipe(Effect.scoped),
  );
});

it.effect("separates host file URLs from readable attachment URLs", () =>
  Effect.gen(function* () {
    const group = WsRpcGroup.omit(
      ...[...WsRpcGroup.requests.keys()].filter(
        (
          tag,
        ): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof WS_METHODS.assetsCreateUrl> =>
          tag !== WS_METHODS.assetsCreateUrl,
      ),
    );
    let handled = 0;
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(
        Layer.mergeAll(
          group.toLayerHandler(WS_METHODS.assetsCreateUrl, () =>
            Effect.sync(() => {
              handled++;
              return { relativeUrl: "/api/assets/file", expiresAt: 1 };
            }),
          ),
          RpcAuthorization.layer([AuthOrchestrationReadScope]),
        ),
      ),
    );
    yield* client[WS_METHODS.assetsCreateUrl]({
      resource: { _tag: "attachment", attachmentId: "image" },
    });
    for (const resource of [
      { _tag: "workspace-file", threadId: ThreadId.make("thread"), path: "file.txt" },
      { _tag: "media-file", threadId: ThreadId.make("thread"), path: "/repo/image.png" },
      { _tag: "draft-workspace-file", cwd: "/repo", path: "file.txt" },
    ] as const) {
      expect(
        yield* client[WS_METHODS.assetsCreateUrl]({ resource }).pipe(Effect.flip),
      ).toMatchObject({
        requiredScope: AuthOrchestrationReadScope,
        requiredPermission: AuthFilesystemReadScope,
      });
    }
    expect(handled).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect("denies manual cleanup before the handler without settings permission", () =>
  Effect.gen(function* () {
    const group = WsRpcGroup.omit(
      ...[...WsRpcGroup.requests.keys()].filter(
        (
          tag,
        ): tag is Exclude<
          keyof typeof RPC_REQUIRED_SCOPES,
          typeof WS_METHODS.serverRunStorageCleanup
        > => tag !== WS_METHODS.serverRunStorageCleanup,
      ),
    );
    let handled = false;
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(
        Layer.mergeAll(
          group.toLayerHandler(WS_METHODS.serverRunStorageCleanup, () =>
            Effect.sync(() => {
              handled = true;
              return {
                trigger: "manual" as const,
                startedAt: "2026-10-09T12:00:00.000Z",
                finishedAt: "2026-10-09T12:00:00.000Z",
                entries: [],
                counts: { removed: 0, kept: 0, failed: 0 },
                omittedCount: 0,
                bytesFreed: 0,
              };
            }),
          ),
          RpcAuthorization.layer([AuthOrchestrationReadScope]),
        ),
      ),
    );
    expect(yield* client[WS_METHODS.serverRunStorageCleanup]({}).pipe(Effect.flip)).toMatchObject({
      requiredPermission: AuthSettingsWriteScope,
    });
    expect(handled).toBe(false);
  }).pipe(Effect.scoped),
);
