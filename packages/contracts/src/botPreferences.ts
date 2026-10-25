import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";
export const BotSharedPreferences = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  author: Schema.NullOr(EnvironmentId),
  primaryEnvironmentId: Schema.NullOr(EnvironmentId),
  overrides: Schema.Record(ProjectId, EnvironmentId),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultRuntimeMode: Schema.NullOr(RuntimeMode),
});
export type BotSharedPreferences = typeof BotSharedPreferences.Type;
export const EMPTY_BOT_SHARED_PREFERENCES: BotSharedPreferences = {
  revision: 0,
  author: null,
  primaryEnvironmentId: null,
  overrides: {},
  defaultModelSelection: null,
  defaultRuntimeMode: null,
};
export const BotPreferencesChange = Schema.Struct({
  primaryEnvironmentId: Schema.optional(Schema.NullOr(EnvironmentId)),
  override: Schema.optional(
    Schema.Struct({ projectId: ProjectId, environmentId: Schema.NullOr(EnvironmentId) }),
  ),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  defaultRuntimeMode: Schema.optional(Schema.NullOr(RuntimeMode)),
});
export type BotPreferencesChange = typeof BotPreferencesChange.Type;
