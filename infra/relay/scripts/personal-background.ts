// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalConsole:off globalTimers:off - Standalone Node transport, disk queue and process lifecycle boundary.
/** Private background delivery; T3 Connect discovery and tunnels stay on their existing relay. */
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Undici from "@effect/platform-node/Undici";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Drizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import { RelayApi } from "@t3tools/contracts/relay";
import * as Api from "../src/http/Api.ts";
import * as Config from "../src/Config.ts";
import * as Db from "../src/db.ts";
import * as Devices from "../src/agentActivity/Devices.ts";
import * as Rows from "../src/agentActivity/AgentActivityRows.ts";
import * as LiveActivities from "../src/agentActivity/LiveActivities.ts";
import * as Attempts from "../src/agentActivity/DeliveryAttempts.ts";
import * as Mobile from "../src/agentActivity/MobileRegistrations.ts";
import * as Publisher from "../src/agentActivity/AgentActivityPublisher.ts";
import * as Apns from "../src/agentActivity/ApnsClient.ts";
import * as Tokens from "../src/agentActivity/ApnsProviderTokens.ts";
import * as Deliveries from "../src/agentActivity/ApnsDeliveries.ts";
import * as Queue from "../src/agentActivity/ApnsDeliveryQueue.ts";
import * as Widgets from "../src/agentActivity/AgentWidgetRefresh.ts";
import * as Fcm from "../src/agentActivity/FcmDeliveries.ts";
import * as Links from "../src/environments/EnvironmentLinks.ts";
import * as Allocations from "../src/environments/ManagedEndpointAllocations.ts";
import * as Endpoints from "../src/environments/ManagedEndpointProvider.ts";
import * as Credentials from "../src/environments/EnvironmentCredentials.ts";
import * as Signatures from "../src/environments/EnvironmentPublishSignatures.ts";
import * as Dpop from "../src/auth/DpopProofs.ts";
import * as RelayTokens from "../src/auth/RelayTokens.ts";
import * as HeldHooks from "../src/hooks/HeldHooks.ts";
import * as Schema from "effect/Schema";

const Settings = Schema.Struct({
  url: Schema.String,
  port: Schema.Int,
  databaseUrl: Schema.String,
  queueDirectory: Schema.String,
  allowedUserId: Schema.NonEmptyString,
  clerkJwtPublicKey: Schema.NonEmptyString,
  cloudMintPrivateKey: Schema.NonEmptyString,
  cloudMintPublicKey: Schema.NonEmptyString,
  jobSigningSecret: Schema.NonEmptyString,
  apnsKeyPath: Schema.String,
  apnsKeyId: Schema.String,
});
const settingsPath = process.argv[2];
if (!settingsPath) throw new Error("Usage: personal-background.ts <private-settings.json>");
const settings = Schema.decodeSync(Schema.fromJsonString(Settings))(
  await NodeFSP.readFile(settingsPath, "utf8"),
);
const origin = new URL(settings.url);
if (origin.protocol !== "https:" || origin.origin !== settings.url)
  throw new Error("Expected HTTPS relay origin");
await NodeFSP.mkdir(settings.queueDirectory, { recursive: true, mode: 0o700 });
const config = Config.layer({
  relayIssuer: settings.url,
  clerkSecretKey: Redacted.make(""),
  clerkPublishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk",
  clerkJwtAudience: "t3-code-relay",
  clerkJwtIssuer: "https://clerk.t3.codes",
  clerkJwtPublicKey: settings.clerkJwtPublicKey,
  allowedUserIds: [settings.allowedUserId],
  cloudMintPrivateKey: Redacted.make(settings.cloudMintPrivateKey),
  cloudMintPublicKey: settings.cloudMintPublicKey,
  apnsDeliveryJobSigningSecret: Redacted.make(settings.jobSigningSecret),
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
  apns: {
    teamId: "BNKA7GN2H2",
    keyId: settings.apnsKeyId,
    privateKey: Redacted.make(await NodeFSP.readFile(settings.apnsKeyPath, "utf8")),
    bundleId: "com.jakeleventhal.t3code",
    environment: "sandbox",
  },
});
const queue = Queue.layer.pipe(
  Layer.provide(
    Layer.succeed(Queue.ApnsDeliveryQueueSender, {
      send: (body) =>
        Effect.tryPromise({
          try: async () => {
            const path = NodePath.join(settings.queueDirectory, `${body.payload.jobId}.json`);
            const temporary = `${path}.tmp`;
            await NodeFSP.writeFile(temporary, JSON.stringify(body), { mode: 0o600 });
            await NodeFSP.rename(temporary, path);
          },
          catch: (cause) => new Queue.ApnsDeliveryQueueStorageError({ cause }),
        }),
    }),
  ),
);
const database = Layer.effect(Db.RelayDb, Drizzle.makeWithDefaults()).pipe(
  Layer.provide(PgClient.layer({ url: Redacted.make(settings.databaseUrl), prepare: false })),
);
const dispatcher = new Undici.Agent({ allowH2: true });
const http = NodeHttpClient.layerUndiciNoDispatcher.pipe(
  Layer.provide(Layer.succeed(NodeHttpClient.Dispatcher, dispatcher)),
);
const services = Layer.empty.pipe(
  Layer.provideMerge(Mobile.layer),
  Layer.provideMerge(Publisher.layer),
  Layer.provideMerge(Deliveries.layer.pipe(Layer.provideMerge(Widgets.layer))),
  Layer.provideMerge(
    Layer.succeed(Fcm.FcmDeliveries, {
      enqueue: () =>
        Effect.fail(
          new Fcm.FcmDeliveryError({ operation: "enqueue", cause: "iOS-only personal relay" }),
        ),
      process: () =>
        Effect.fail(
          new Fcm.FcmDeliveryError({ operation: "decode-job", cause: "iOS-only personal relay" }),
        ),
    }),
  ),
  Layer.provideMerge(Apns.layer.pipe(Layer.provideMerge(Tokens.layer))),
  Layer.provideMerge(queue),
  Layer.provideMerge(
    Layer.mergeAll(
      Rows.layer,
      Devices.layer,
      LiveActivities.layer,
      Attempts.layer,
      Links.layer,
      Credentials.layer,
      Signatures.layer,
      Allocations.layer,
      RelayTokens.layer,
    ),
  ),
  Layer.provideMerge(Dpop.layer),
  Layer.provideMerge(Db.RelayTransactions.layer.pipe(Layer.provideMerge(database))),
  Layer.provideMerge(config),
  Layer.provideMerge(http),
  Layer.provideMerge(NodeServices.layer),
);
const runtime = ManagedRuntime.make(services);
const backgroundApi = HttpApi.make("RelayApi").add(
  RelayApi.groups.health,
  RelayApi.groups.metadata,
  RelayApi.groups.mobile,
  RelayApi.groups.widget,
  RelayApi.groups.token,
  RelayApi.groups.server,
);
const endpoints = Layer.succeed(Endpoints.ManagedEndpointProvider, {
  provision: (input) =>
    Effect.fail(
      new Endpoints.ManagedEndpointProvisioningNotConfigured({
        userId: input.userId,
        environmentId: input.environmentId,
        missingSettings: ["managedEndpointBaseDomain", "managedEndpointNamespace"],
      }),
    ),
  reconcileOrigin: (input) =>
    Effect.fail(
      new Endpoints.ManagedEndpointProvisioningNotConfigured({
        userId: input.userId,
        environmentId: input.environmentId,
        missingSettings: ["managedEndpointBaseDomain", "managedEndpointNamespace"],
      }),
    ),
  prepareDeprovision: () => Effect.succeed(null),
  deprovision: () => Effect.succeed(false),
  release: () => Effect.succeed(false),
});
const api = HttpApiBuilder.layer(backgroundApi).pipe(
  Layer.provide(
    Layer.mergeAll(
      Api.layerHealthApi,
      Api.layerMetadataApi,
      Api.layerMobileApi,
      Api.layerWidgetApi,
      Api.layerTokenApi,
      Api.layerServerApi,
    ),
  ),
  Layer.provide(Api.layerDpopClientAuth),
  Layer.provide(Api.layerEnvironmentAuth),
  // This deployment exposes no managed tunnels or held webhook functionality.
  Layer.provide(
    Layer.succeed(HeldHooks.HeldHooks, {
      resolveEndpoint: () => Effect.succeed(null),
      setHoldWhileOffline: () => Effect.void,
      wake: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(Layer.effectContext(runtime.contextEffect)),
);
const server = ManagedRuntime.make(
  HttpRouter.serve(api, { disableLogger: true }).pipe(
    Layer.provide(endpoints),
    Layer.provide(Layer.effectContext(runtime.contextEffect)),
    Layer.provide(
      NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: settings.port }),
    ),
  ),
);
await server.context();
let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (const file of (await NodeFSP.readdir(settings.queueDirectory))
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const path = NodePath.join(settings.queueDirectory, file);
      const body: unknown = JSON.parse(await NodeFSP.readFile(path, "utf8"));
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const deliveries = yield* Deliveries.ApnsDeliveries;
          return yield* deliveries.processSignedJob(body).pipe(
            Effect.match({
              onSuccess: (delivery) => ({ delivery, error: null }),
              onFailure: (error) => ({ delivery: null, error: error._tag }),
            }),
          );
        }),
      );
      console.log(JSON.stringify({ event: "personal_apns_delivery", ...result }));
      const status = result.delivery?.apnsStatus;
      const permanentFailure = status != null && status >= 400 && status < 500 && status !== 429;
      if (result.delivery?.ok || permanentFailure || result.error === "ApnsDeliveryJobExpired") {
        await NodeFSP.unlink(path);
      }
    }
  } finally {
    draining = false;
  }
}
const timer = setInterval(() => {
  void drain().catch(() => console.error("Personal delivery queue failed"));
}, 10_000);
await drain();
console.log(JSON.stringify({ event: "personal_background_ready", origin: settings.url }));
async function shutdown() {
  clearInterval(timer);
  await server.dispose();
  await runtime.dispose();
  await dispatcher.close();
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
