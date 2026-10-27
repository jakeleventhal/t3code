// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { GrokSettings } from "@t3tools/provider-grok/settings";
import { classifyGrokMediaRefusal, makeGrokMediaGeneration } from "@t3tools/provider-grok/testing";
import { execScriptSource, writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../provider/testFixtures/grok-text-mock-agent.mjs");

function withFakeGrok<A, E, R>(
  env: Record<string, string>,
  run: (
    media: Effect.Success<ReturnType<typeof makeGrokMediaGeneration>>,
  ) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-grok-media-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
    );
    const binaryPath = writeFakeCli({
      directory: NodePath.join(tempDir, "bin"),
      name: "grok",
      env,
      source: execScriptSource({
        scriptPath: mockAgentPath,
        // Headless media turns run with approvals granted up front.
        expectedArgs: ["agent", "--always-approve", "stdio"],
      }),
    });
    const media = yield* makeGrokMediaGeneration(decodeGrokSettings({ binaryPath }));
    return yield* run(media);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
}

const session = "/tmp/grok-sessions/abc";
const imageCall = (id: string, prompt: string, file: string) => [
  {
    sessionUpdate: "tool_call",
    toolCallId: id,
    title: "image_gen",
    status: "in_progress",
    rawInput: { prompt, aspect_ratio: "1:1" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: "completed",
    rawOutput: JSON.stringify({
      path: `${session}/images/${file}`,
      filename: file,
      session_folder: "images",
      message: `Image generated and saved to ${session}/images/${file}.`,
    }),
  },
];

describe("GrokMediaGeneration", () => {
  it.effect("maps image_gen results back to the prompts that asked for them", () =>
    withFakeGrok(
      {
        T3_ACP_TOOL_UPDATES: JSON.stringify([
          ...imageCall("c2", "second look", "2.jpg"),
          ...imageCall("c1", "first look", "1.jpg"),
        ]),
        // A fabricated reply cannot replace the image returned by its actual tool call.
        T3_ACP_PROMPT_RESPONSE_TEXT: 'Done! {"images":[{"index":1,"path":"/tmp/invented.jpg"}]}',
      },
      (media) =>
        Effect.gen(function* () {
          const result = yield* media.generateImages({
            cwd: process.cwd(),
            prompts: ["first look", "second look"],
            aspectRatio: "1:1",
          });
          expect(result.paths).toEqual([`${session}/images/1.jpg`, `${session}/images/2.jpg`]);
        }),
    ),
  );

  it.effect("turns a credits refusal into a quota error carrying the provider's words", () =>
    withFakeGrok(
      {
        T3_ACP_TOOL_UPDATES: JSON.stringify([
          {
            sessionUpdate: "tool_call",
            toolCallId: "v1",
            title: "reference_to_video",
            status: "failed",
            rawOutput:
              'Tool `reference_to_video` failed: Video generation failed with HTTP 402 Payment Required: {"code":"personal-team-blocked:spending-limit","error":"You have run out of credits or need a Grok subscription. Add credits at https://grok.com/?_s=usage or upgrade at https://grok.com/supergrok."}',
          },
        ]),
        T3_ACP_PROMPT_RESPONSE_TEXT: '{"error":"The video tool refused."}',
      },
      (media) =>
        Effect.gen(function* () {
          const error = yield* media.generateVideo!({
            cwd: process.cwd(),
            prompt: "idle",
            referenceImagePath: "/tmp/still.png",
            durationSeconds: 6,
            resolution: "480p",
            aspectRatio: "1:1",
          }).pipe(Effect.flip);
          assert.equal(error.reason, "quota");
          assert.ok(error.providerMessage?.startsWith("You have run out of credits"));
        }),
    ),
  );

  it.effect("ignores paths in reference documents and reads the actual video tool result", () =>
    withFakeGrok(
      {
        T3_ACP_TOOL_UPDATES: JSON.stringify([
          { sessionUpdate: "tool_call", toolCallId: "read", title: "read_file" },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "read",
            status: "completed",
            rawOutput: "Old trial: /tmp/old.mp4",
          },
          { sessionUpdate: "tool_call", toolCallId: "v1", title: "reference_to_video" },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "v1",
            status: "completed",
            rawOutput: JSON.stringify({ path: `${session}/videos/1.mp4`, filename: "1.mp4" }),
          },
        ]),
        T3_ACP_PROMPT_RESPONSE_TEXT: "",
      },
      (media) =>
        Effect.gen(function* () {
          const result = yield* media.generateVideo!({
            cwd: process.cwd(),
            prompt: "idle",
            referenceImagePath: "/tmp/still.png",
            durationSeconds: 6,
            resolution: "480p",
            aspectRatio: "1:1",
          });
          expect(result.path).toBe(`${session}/videos/1.mp4`);
        }),
    ),
  );

  it.effect("rejects an invented video filename without a completed tool result", () =>
    withFakeGrok(
      { T3_ACP_PROMPT_RESPONSE_TEXT: '{"video":{"path":"/tmp/invented.mp4"}}' },
      (media) =>
        Effect.gen(function* () {
          const failure = yield* media.generateVideo!({
            cwd: process.cwd(),
            prompt: "idle",
            referenceImagePath: "/tmp/still.png",
            durationSeconds: 6,
            resolution: "480p",
            aspectRatio: "1:1",
          }).pipe(Effect.flip);
          assert.equal(failure.reason, "failed");
        }),
    ),
  );

  it("recognises Grok's refusal wording", () => {
    expect(classifyGrokMediaRefusal("HTTP 402 Payment Required")).toBe("quota");
    expect(
      classifyGrokMediaRefusal(
        "Video generation is a SuperGrok feature and isn't available on the free tier.",
      ),
    ).toBe("quota");
    expect(classifyGrokMediaRefusal("blocked by zero data retention policy")).toBe("privacy");
    expect(classifyGrokMediaRefusal("Image generated and saved to /x/1.jpg")).toBeNull();
  });
});
