import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BotMentionItem } from "@t3tools/client-runtime/botMentionItems";
import {
  ComposerContextId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  type OrchestrationMessageContext,
  type ServerProvider,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";

const refreshProviders = vi.hoisted(() => vi.fn());
const pathSearch = vi.hoisted(() => vi.fn());
const botMentionItems = vi.hoisted(() => ({ current: [] as unknown[] }));
const drafts = vi.hoisted(() => ({
  context: undefined as OrchestrationMessageContext | undefined,
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
// The hook runs once outside a renderer: state keeps its initial value and effects are skipped.
vi.mock("react", () => ({
  useState: (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    () => {},
  ],
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));

vi.mock("../../state/queries", () => ({
  useComposerPathSearch: (input: unknown) => {
    pathSearch(input);
    return {
      entries: [{ path: "src/index.ts", kind: "file" }],
      isPending: false,
    };
  },
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => ({ text: "", context: drafts.context }),
  readComposerDraftSelection: () => null,
  useComposerDraftSelection: vi.fn(),
  setComposerDraftContext: (_key: string, context: OrchestrationMessageContext) => {
    drafts.context = context;
  },
}));
vi.mock("./use-bot-mention-items", () => ({
  useBotMentionItems: (input: { bot: unknown; query: string | null }) => ({
    items: input.bot !== null && input.query !== null ? botMentionItems.current : [],
    isLoading: false,
  }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "context-id" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: vi.fn(),
    refreshProviders: Symbol("refreshProviders"),
  },
}));

import {
  buildComposerSlashCommandItems,
  resolveComposerCommandSelection,
  resolveComposerMenuSelection,
  useComposerCommandMenu,
} from "./use-composer-command-menu";

describe("resolveComposerMenuSelection", () => {
  it("prefers the caret an insertion placed in the current draft text", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hello @chip ",
        ownerKey: "draft-a",
        inserted: { start: 12, end: 12 },
        local: { ownerKey: "draft-a", start: 2, end: 2 },
      }),
    ).toEqual({ start: 12, end: 12 });
  });

  it("clamps the composer's own caret when the draft shrinks", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hi",
        ownerKey: "draft-a",
        inserted: null,
        local: { ownerKey: "draft-a", start: 5, end: 9 },
      }),
    ).toEqual({ start: 2, end: 2 });
  });

  it("starts at the end of the draft after switching owners", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "other draft",
        ownerKey: "draft-b",
        inserted: null,
        local: { ownerKey: "draft-a", start: 1, end: 1 },
      }),
    ).toEqual({ start: 11, end: 11 });
  });
});

describe("mobile slash commands", () => {
  const antigravity = {
    driver: ProviderDriverKind.make("antigravity"),
    showInteractionModeToggle: false,
    slashCommands: [{ name: "plan", description: "Plan with Antigravity" }],
  };

  it.each([false, true])(
    "keeps native /plan with legacy mode enabled=%s",
    (allowInteractionMode) => {
      const items = buildComposerSlashCommandItems({
        query: "pl",
        atMessageStart: true,
        hasThread: true,
        allowInteractionMode,
        selectedProviderStatus: antigravity,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.type).toBe("provider-slash-command");
      const item = items[0];
      if (!item) throw new Error("Expected the native plan command");
      expect(
        resolveComposerCommandSelection({
          draftMessage: "/pl",
          trigger: { rangeStart: 0, rangeEnd: 3 },
          item,
          allowInteractionMode,
        }),
      ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
    },
  );

  it("still applies the T3 plan command for supported providers", () => {
    const items = buildComposerSlashCommandItems({
      query: "plan",
      atMessageStart: true,
      hasThread: true,
      allowInteractionMode: true,
      selectedProviderStatus: {
        driver: ProviderDriverKind.make("codex"),
        slashCommands: [],
      },
    });
    const item = items[0];
    if (!item) throw new Error("Expected the T3 plan command");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: true,
      }),
    ).toEqual({ text: "", cursor: 0, interactionMode: "plan" });

    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: false,
      }),
    ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
  });
});

describe("bot chat slash commands", () => {
  it("leaves out T3's runtime commands but keeps the provider's own", () => {
    const items = buildComposerSlashCommandItems({
      query: "",
      atMessageStart: true,
      hasThread: true,
      hasCompactableConversation: true,
      allowInteractionMode: true,
      offersRuntimeCommands: false,
      selectedProviderStatus: {
        driver: ProviderDriverKind.make("claudeAgent"),
        slashCommands: [
          { name: "compact", description: "Compact the conversation" },
          { name: "goal", description: "Set a goal" },
        ],
      },
    });
    expect(items.map((item) => item.label)).toEqual(["/compact", "/goal"]);
  });
});

describe("composer @ menu", () => {
  const environmentId = EnvironmentId.make("env-home");
  const bot = { environmentId, projectId: ProjectId.make("bot-researcher") };
  const reference = {
    version: 1,
    kind: "project",
    contextId: ComposerContextId.make("project_env-home_t3code"),
    label: "t3code",
    environmentId,
    projectId: ProjectId.make("t3code"),
    title: "t3code",
    botRole: null,
  } as const;
  const projectItem: BotMentionItem = {
    id: "reference:project:env-home:t3code",
    type: "reference",
    group: "projects",
    reference,
    label: "t3code",
    description: "Project",
  };

  const menu = (input: {
    readonly draftMessage: string;
    readonly bot?: typeof bot | null;
    readonly onChangeDraftMessage?: (value: string) => void;
  }) =>
    useComposerCommandMenu({
      draftMessage: input.draftMessage,
      ownerKey: "draft",
      environmentId,
      bot: input.bot ?? null,
      projectCwd: "/repo",
      selectedProviderStatus: null as ServerProvider | null,
      hasThread: true,
      hasCompactableConversation: false,
      onChangeDraftMessage: input.onChangeDraftMessage ?? (() => {}),
    });

  beforeEach(() => {
    pathSearch.mockClear();
    botMentionItems.current = [projectItem];
    drafts.context = undefined;
  });

  it("offers a bot only its curated context and never searches the workspace", () => {
    const result = menu({ draftMessage: "Look at @t3", bot });

    expect(result.items).toEqual([projectItem]);
    expect(result.botMentions).toBe(true);
    expect(pathSearch).toHaveBeenCalledWith({ environmentId, cwd: null, query: null });
  });

  it("keeps workspace file search in Code threads", () => {
    const result = menu({ draftMessage: "Look at @ind" });

    expect(result.items.map((item) => item.type)).toEqual(["path"]);
    expect(result.botMentions).toBe(false);
    expect(pathSearch).toHaveBeenCalledWith({ environmentId, cwd: "/repo", query: "ind" });
  });

  it("inserts the picked reference and attaches it once", () => {
    const onChangeDraftMessage = vi.fn();
    const draftMessage = "Look at @t3";
    menu({ draftMessage, bot, onChangeDraftMessage }).onSelect(projectItem);
    menu({ draftMessage, bot, onChangeDraftMessage }).onSelect(projectItem);

    expect(onChangeDraftMessage).toHaveBeenLastCalledWith(
      `Look at ${formatComposerContextReference(reference)} `,
    );
    expect(drafts.context?.records).toEqual([reference]);
  });
});
