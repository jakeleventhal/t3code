import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const ProviderMediaGenerationReason = Schema.Literals([
  /** The account cannot use this tool: tier, credits, or a spending limit. */
  "quota",
  /** The account's privacy or data-sharing settings block generation. */
  "privacy",
  /** The provider declined the request for another stated reason. */
  "refused",
  "timeout",
  "failed",
]);
export type ProviderMediaGenerationReason = typeof ProviderMediaGenerationReason.Type;

export class ProviderMediaGenerationError extends Schema.TaggedError<ProviderMediaGenerationError>()(
  "ProviderMediaGenerationError",
  {
    operation: Schema.Literals(["generateImages", "generateVideo"]),
    reason: ProviderMediaGenerationReason,
    /** The provider's own words when they tell the user what to change; bounded, never raw output. */
    providerMessage: Schema.optional(Schema.String.check(Schema.isMaxLength(600))),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Media generation (${this.operation}) failed: ${this.reason}.`;
  }
}

export interface ImageGenerationInput {
  /** Where the provider session runs; generated files may be written below it. */
  readonly cwd: string;
  /** One image per prompt, returned in the same order. */
  readonly prompts: ReadonlyArray<string>;
  readonly aspectRatio: "1:1";
}

export interface ImageGenerationResult {
  /** Absolute paths, in prompt order. Missing entries are prompts the provider did not fulfil. */
  readonly paths: ReadonlyArray<string | null>;
}

export interface VideoGenerationInput {
  readonly cwd: string;
  readonly prompt: string;
  /** The identity reference, optionally also used as the opening and closing frame. */
  readonly referenceImagePath: string;
  readonly pinReferencePose?: boolean;
  readonly durationSeconds: 6 | 10;
  readonly resolution: "480p" | "720p";
  readonly aspectRatio: "1:1";
}

export interface VideoGenerationResult {
  readonly path: string;
}

/** Native image and video generation on the user's connected account, where a driver offers it. */
export interface ProviderMediaGeneration {
  readonly generateImages: (
    input: ImageGenerationInput,
  ) => Effect.Effect<ImageGenerationResult, ProviderMediaGenerationError>;
  readonly generateVideo?: (
    input: VideoGenerationInput,
  ) => Effect.Effect<VideoGenerationResult, ProviderMediaGenerationError>;
}
