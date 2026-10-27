import type { OrchestrationMessageContext } from "@t3tools/contracts";

export function botMessageReactions(
  messages: ReadonlyArray<{
    readonly context?: OrchestrationMessageContext | null | undefined;
    readonly role: string;
  }>,
) {
  const reactions = new Map<string, string>();
  for (const message of messages) {
    const reaction = message.role === "user" ? message.context?.botReaction : undefined;
    if (!reaction) continue;
    if (reaction.emoji === null) reactions.delete(reaction.messageId);
    else reactions.set(reaction.messageId, reaction.emoji);
  }
  return reactions;
}

export function silentBotReactionReplyIds(
  messages: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly text: string;
    readonly runId: string | null;
    readonly streaming: boolean;
    readonly context?: OrchestrationMessageContext | null | undefined;
  }>,
) {
  const runs = new Set(
    messages.flatMap((message) =>
      message.role === "user" && message.context?.botReaction && message.runId
        ? [message.runId]
        : [],
    ),
  );
  return new Set(
    messages
      .filter((message) => {
        if (message.role !== "assistant" || !message.runId || !runs.has(message.runId))
          return false;
        const text = message.text.trim();
        return (
          text === "[no-reply]" ||
          (message.streaming && text.length > 0 && "[no-reply]".startsWith(text))
        );
      })
      .map((message) => message.id),
  );
}
