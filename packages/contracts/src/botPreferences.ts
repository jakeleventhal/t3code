import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { VoiceSelection } from "./botVoice.ts";
import { RuntimeMode } from "./providerPolicy.ts";
const SharedVoice = Schema.Struct({
  ...VoiceSelection.fields,
  connectionKind: Schema.Literals(["openai-api", "xai-api", "codex-subscription"]),
});
const VoiceOverride = Schema.Union([SharedVoice, Schema.Null, Schema.Literal("inherit")]);
const BotRuntimeOverride = Schema.Struct({
  modelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  runtimeMode: Schema.optionalKey(Schema.NullOr(RuntimeMode)),
});
export const BotSharedPreferences = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  author: Schema.NullOr(EnvironmentId),
  primaryEnvironmentId: Schema.NullOr(EnvironmentId),
  overrides: Schema.Record(ProjectId, EnvironmentId),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultRuntimeMode: Schema.NullOr(RuntimeMode),
  complexTaskModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  complexTaskModelOverrides: Schema.optionalKey(Schema.Record(ProjectId, ModelSelection)),
  defaultVoice: Schema.optionalKey(Schema.NullOr(SharedVoice)),
  runtimeOverrides: Schema.optionalKey(Schema.Record(ProjectId, BotRuntimeOverride)),
  voiceOverrides: Schema.optionalKey(Schema.Record(ProjectId, VoiceOverride)),
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
  complexTaskModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  complexTaskModelOverride: Schema.optional(
    Schema.Struct({
      projectId: ProjectId,
      selection: Schema.NullOr(ModelSelection),
    }),
  ),
  defaultVoiceSelection: Schema.optional(Schema.NullOr(VoiceSelection)),
  runtimeOverride: Schema.optional(
    Schema.Struct({ projectId: ProjectId, ...BotRuntimeOverride.fields }),
  ),
  voiceOverride: Schema.optional(
    Schema.Struct({
      projectId: ProjectId,
      selection: Schema.Union([VoiceSelection, Schema.Null, Schema.Literal("inherit")]),
    }),
  ),
});
export type BotPreferencesChange = typeof BotPreferencesChange.Type;
