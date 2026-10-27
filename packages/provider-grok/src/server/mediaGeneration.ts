import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/compat";

import {
  ProviderMediaGenerationError,
  type ImageGenerationInput,
  type ProviderMediaGeneration,
  type ProviderMediaGenerationReason,
  type VideoGenerationInput,
} from "@t3tools/provider-core/server/mediaGeneration";
import type { GrokSettings } from "../settings.ts";
import { makeGrokAcpRuntime } from "./acpSupport.ts";

const IMAGE_TIMEOUT_MS = 4 * 60_000;
const VIDEO_TIMEOUT_MS = 8 * 60_000;
const MEDIA_PATH_PATTERN = /(?:\/|[A-Za-z]:\\)[^\s"'`<>]+?\.(?:png|jpe?g|webp|mp4)/gi;
const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownOption(UnknownFromJsonString);
const encodeJson = Schema.encodeUnknownOption(UnknownFromJsonString);
const isMediaGenerationError = Schema.is(ProviderMediaGenerationError);
const quote = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/** Grok Build's own wording for the ways Imagine refuses; checked against tool output and replies. */
export function classifyGrokMediaRefusal(text: string): ProviderMediaGenerationReason | null {
  const lower = text.toLowerCase();
  if (
    /\b402\b/.test(lower) ||
    lower.includes("payment required") ||
    lower.includes("spending-limit") ||
    lower.includes("spending limit") ||
    lower.includes("out of credits") ||
    lower.includes("supergrok") ||
    lower.includes("need a grok subscription") ||
    lower.includes("insufficient credits")
  )
    return "quota";
  if (
    lower.includes("zero data retention") ||
    lower.includes("zero-data-retention") ||
    lower.includes("data retention") ||
    lower.includes("data sharing") ||
    lower.includes("privacy setting") ||
    lower.includes("coding_data_sharing")
  )
    return "privacy";
  if (
    lower.includes("not available on") ||
    lower.includes("is disabled") ||
    lower.includes("not enabled") ||
    lower.includes("do not retry this tool")
  )
    return "refused";
  return null;
}

/** The first actionable sentence of a refusal, bounded so it can travel inside an error. */
function refusalMessage(text: string): string {
  const match = text.match(/"error"\s*:\s*"([^"]{1,400})"/);
  const sentence = (match?.[1] ?? text).replace(/\s+/g, " ").trim();
  return sentence.length > 400 ? `${sentence.slice(0, 399)}…` : sentence;
}

function textOfToolUpdate(update: EffectAcpSchema.ToolCallUpdate): string {
  const parts: Array<string> = [];
  if (typeof update.rawOutput === "string") parts.push(update.rawOutput);
  else if (update.rawOutput !== undefined && update.rawOutput !== null) {
    const encoded = encodeJson(update.rawOutput);
    if (Option.isSome(encoded)) parts.push(encoded.value);
  }
  for (const block of update.content ?? []) {
    if (block.type === "content" && block.content.type === "text") parts.push(block.content.text);
  }
  return parts.join("\n");
}

interface ToolObservation {
  readonly name: string;
  readonly prompt: string | null;
  readonly paths: ReadonlyArray<string>;
  readonly refusal: {
    readonly reason: ProviderMediaGenerationReason;
    readonly text: string;
  } | null;
}

function observeToolUpdate(update: EffectAcpSchema.ToolCallUpdate): ToolObservation {
  const text = textOfToolUpdate(update);
  const input = update.rawInput;
  const prompt =
    typeof input === "object" &&
    input !== null &&
    "prompt" in input &&
    typeof input.prompt === "string"
      ? input.prompt
      : null;
  const reason = classifyGrokMediaRefusal(text);
  return {
    name: update.title ?? update.name ?? "",
    prompt,
    paths: [...new Set(text.match(MEDIA_PATH_PATTERN) ?? [])],
    refusal: reason === null ? null : { reason, text: refusalMessage(text) },
  };
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return Option.getOrNull(decodeJson(text.slice(start, end + 1)));
}

/**
 * Grok Build exposes Imagine as native agent tools (`image_gen`, `reference_to_video`) rather
 * than an API we can call directly, so a short headless ACP turn asks the agent to make exactly
 * the calls we want and report the saved paths. Tool updates are read as well as the reply, so
 * a chatty agent cannot hide a result, and refusals keep the provider's own reason.
 */
export const makeGrokMediaGeneration = Effect.fn("makeGrokMediaGeneration")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runTurn = Effect.fn("GrokMediaGeneration.runTurn")(function* (input: {
    readonly operation: "generateImages" | "generateVideo";
    readonly cwd: string;
    readonly prompt: string;
    readonly timeoutMs: number;
  }) {
    const replyRef = yield* Ref.make("");
    const toolsRef = yield* Ref.make<ReadonlyArray<ToolObservation>>([]);
    const byCallId = new Map<string, ToolObservation>();
    const result = yield* Effect.gen(function* () {
      // Media tools write below the session folder; full access keeps a headless turn from
      // waiting on an approval nobody can answer.
      const runtime = yield* makeGrokAcpRuntime({
        grokSettings,
        environment,
        cwd: input.cwd,
        runtimeMode: "full-access",
        clientInfo: { name: "t3-code-bot-avatar", version: "0.0.0" },
      }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, commandSpawner),
      );
      yield* runtime.handleRequestPermission((request) => {
        const allow =
          request.options.find((option) => option.kind === "allow_once") ??
          request.options.find((option) => option.kind === "allow_always");
        return Effect.succeed(
          allow === undefined
            ? { outcome: { outcome: "cancelled" as const } }
            : { outcome: { outcome: "selected" as const, optionId: allow.optionId } },
        );
      });
      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate === "agent_message_chunk") {
          const content = update.content;
          return content.type === "text"
            ? Ref.update(replyRef, (current) => current + content.text)
            : Effect.void;
        }
        if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
          return Effect.void;
        }
        const observed = observeToolUpdate(update);
        const previous = byCallId.get(update.toolCallId);
        const merged: ToolObservation = {
          name: previous?.name || observed.name,
          prompt: observed.prompt ?? previous?.prompt ?? null,
          paths: [...new Set([...(previous?.paths ?? []), ...observed.paths])],
          refusal: observed.refusal ?? previous?.refusal ?? null,
        };
        byCallId.set(update.toolCallId, merged);
        return Ref.set(toolsRef, [...byCallId.values()]);
      });
      yield* runtime.start();
      return yield* runtime.prompt({ prompt: [{ type: "text", text: input.prompt }] });
    }).pipe(
      Effect.timeoutOption(input.timeoutMs),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ProviderMediaGenerationError({ operation: input.operation, reason: "timeout" }),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError((cause) =>
        isMediaGenerationError(cause)
          ? cause
          : new ProviderMediaGenerationError({
              operation: input.operation,
              reason: "failed",
              cause,
            }),
      ),
    );
    return {
      stopReason: result.stopReason,
      reply: yield* Ref.get(replyRef),
      tools: yield* Ref.get(toolsRef),
    };
  }, Effect.scoped);

  const generateImages = Effect.fn("GrokMediaGeneration.generateImages")(function* (
    input: ImageGenerationInput,
  ) {
    const numbered = input.prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n");
    const turn = yield* runTurn({
      operation: "generateImages",
      cwd: input.cwd,
      timeoutMs: IMAGE_TIMEOUT_MS,
      prompt: [
        `Generate ${input.prompts.length} images with the image_gen tool, one call per prompt below, all with aspect_ratio "${input.aspectRatio}". Issue every call now, in parallel, with the prompt text exactly as written. Do not read, edit, describe, or open the images afterwards.`,
        "",
        numbered,
        "",
        'When every call has finished, reply with only this JSON and nothing else: {"images":[{"index":1,"path":"<absolute path>"},...]} listing each prompt number with its saved absolute path. If a call failed, use null for its path and add an "error" string with the tool\'s message.',
      ].join("\n"),
    });
    const refusal =
      turn.tools.find((tool) => tool.name === "image_gen" && tool.refusal !== null)?.refusal ??
      null;
    const parsed = extractJsonObject(turn.reply) as {
      images?: ReadonlyArray<{ index?: number; path?: string | null; error?: string }>;
    } | null;
    const imageTools = turn.tools.filter(
      (tool) => tool.name === "image_gen" && tool.paths.length > 0,
    );
    const generatedPaths = new Set(imageTools.flatMap((tool) => tool.paths));
    const paths: Array<string | null> = input.prompts.map(() => null);
    for (const entry of parsed?.images ?? []) {
      const index = typeof entry.index === "number" ? entry.index - 1 : -1;
      if (
        index >= 0 &&
        index < paths.length &&
        typeof entry.path === "string" &&
        generatedPaths.has(entry.path)
      )
        paths[index] = entry.path;
    }
    // The reply can lie or be cut off; tool outputs are the record of what was really saved.
    for (const [index, prompt] of input.prompts.entries()) {
      if (paths[index] !== null) continue;
      const byPrompt = imageTools.find((tool) => tool.prompt === prompt);
      if (byPrompt) paths[index] = byPrompt.paths[0] ?? null;
    }
    const unused = imageTools.flatMap((tool) => tool.paths).filter((path) => !paths.includes(path));
    for (const [index] of paths.entries()) {
      if (paths[index] === null && unused.length > 0) paths[index] = unused.shift() ?? null;
    }
    if (paths.every((path) => path === null)) {
      const text = refusal?.text ?? turn.reply;
      const reason = refusal?.reason ?? classifyGrokMediaRefusal(turn.reply) ?? "failed";
      return yield* new ProviderMediaGenerationError({
        operation: "generateImages",
        reason,
        ...(reason === "failed" ? {} : { providerMessage: refusalMessage(text) }),
      });
    }
    return { paths };
  });

  const generateVideo = Effect.fn("GrokMediaGeneration.generateVideo")(function* (
    input: VideoGenerationInput,
  ) {
    const turn = yield* runTurn({
      operation: "generateVideo",
      cwd: input.cwd,
      timeoutMs: VIDEO_TIMEOUT_MS,
      prompt: [
        "Create a real animated video now using your native reference_to_video tool. Invoke the tool and wait for its completed result before answering. Do not simulate a tool response or invent a filename. If the tool cannot run, report its actual error. Do not inspect or re-display the completed video.",
        "",
        `prompt: ${quote(input.pinReferencePose === false ? input.prompt.replaceAll("<IMAGE_1>", "<IMAGE_0>") : input.prompt)}`,
        `images: [${quote(input.referenceImagePath)}]`,
        ...(input.pinReferencePose === false
          ? []
          : [
              `first_frame: ${quote(input.referenceImagePath)}`,
              `last_frame: ${quote(input.referenceImagePath)}`,
            ]),
        `aspect_ratio: "${input.aspectRatio}"`,
        `duration: ${input.durationSeconds}`,
        `resolution_name: "${input.resolution}"`,
        "voices: omitted (no voices, no audio)",
        "",
        'When the call has finished, reply with only this JSON and nothing else: {"video":{"path":"<absolute path>"}} or, if it failed, {"error":"<the tool\'s message>"}.',
      ].join("\n"),
    });
    const parsed = extractJsonObject(turn.reply) as {
      video?: { path?: string };
      error?: string;
    } | null;
    const videoTools = turn.tools.filter(
      (tool) => tool.name === "reference_to_video" || tool.name === "image_to_video",
    );
    const fromTools = videoTools.flatMap((tool) => tool.paths).find((path) => /\.mp4$/i.test(path));
    // A textual reply can invent a plausible path without ever invoking Imagine.
    const path = fromTools ?? null;
    if (path === null) {
      const refusal = videoTools.find((tool) => tool.refusal !== null)?.refusal ?? null;
      const text = refusal?.text ?? parsed?.error ?? turn.reply;
      const reason = refusal?.reason ?? classifyGrokMediaRefusal(text) ?? "failed";
      return yield* new ProviderMediaGenerationError({
        operation: "generateVideo",
        reason,
        ...(reason === "failed" && !parsed?.error ? {} : { providerMessage: refusalMessage(text) }),
      });
    }
    return { path };
  });

  return { generateImages, generateVideo } satisfies ProviderMediaGeneration;
});
