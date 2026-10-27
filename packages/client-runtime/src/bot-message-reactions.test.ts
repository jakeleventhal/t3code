import { MessageId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { botMessageReactions, silentBotReactionReplyIds } from "./bot-message-reactions";

it("keeps the latest reaction per message and removes it without affecting other messages", () => {
  const reaction = (id: string, emoji: string | null) => ({
    role: "user",
    context: {
      version: 1 as const,
      records: [],
      botReaction: { messageId: MessageId.make(id), text: "Quoted reply", emoji },
    },
  });
  expect([
    ...botMessageReactions([
      reaction("a", "👍"),
      reaction("b", "❤️"),
      reaction("a", "😂"),
      reaction("b", null),
    ]),
  ]).toEqual([["a", "😂"]]);
});

it("hides only the silence marker in reaction turns, including its streaming prefix", () => {
  const messages = [
    {
      id: "reaction",
      role: "user",
      text: "😂",
      runId: "r1",
      streaming: false,
      context: {
        version: 1 as const,
        records: [],
        botReaction: { messageId: MessageId.make("target"), text: "A joke", emoji: "😂" },
      },
    },
    { id: "quiet", role: "assistant", text: "[no-reply]", runId: "r1", streaming: false },
    { id: "partial", role: "assistant", text: "[no-", runId: "r1", streaming: true },
    { id: "action", role: "assistant", text: "I applied option B.", runId: "r1", streaming: false },
    { id: "ordinary", role: "assistant", text: "[no-reply]", runId: "r2", streaming: false },
  ];
  expect([...silentBotReactionReplyIds(messages)]).toEqual(["quiet", "partial"]);
});
