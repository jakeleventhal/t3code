import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const PublisherConfig = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^/?#]+\/?$/)),
  environmentCredential: Schema.NonEmptyString,
});

const decodePublisherConfig = Schema.decodeEffect(Schema.fromJsonString(PublisherConfig));

export class PersonalBackgroundConfigInvalid extends Schema.TaggedError<PersonalBackgroundConfigInvalid>()(
  "PersonalBackgroundConfigInvalid",
  {},
) {}

// Separate from the T3 Connect link: personal APNs delivery must not replace
// the credentials that keep existing remote connections working.
export class PersonalBackgroundConfig extends Context.Reference<typeof PublisherConfig.Type | null>(
  "t3/personal/BackgroundConfig",
  { defaultValue: (): typeof PublisherConfig.Type | null => null },
) {}

export const layer = Layer.effect(
  PersonalBackgroundConfig,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const path = paths.join(NodeOS.homedir(), ".config", "t3-personal-relay", "publisher.json");
    if (!(yield* fs.exists(path))) return null;
    const config = yield* decodePublisherConfig(yield* fs.readFileString(path)).pipe(
      Effect.mapError(() => new PersonalBackgroundConfigInvalid()),
    );
    return { ...config, url: config.url.replace(/\/$/, "") };
  }),
);
