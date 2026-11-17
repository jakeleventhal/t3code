import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

// TLS terminates at the loopback proxy; proof URLs use the pinned public origin.
export const personalRelayOrigin = (origin: URL) =>
  HttpMiddleware.make((app) =>
    Effect.updateService(app, HttpServerRequest.HttpServerRequest, (request) =>
      request.modify({
        protocol: "https",
        headers: Headers.set(request.headers, "host", origin.host),
      }),
    ),
  );
