import { observeVisibleAnimation } from "../../lib/visibleAnimation";

export function TypingDots() {
  return (
    <span
      ref={observeVisibleAnimation}
      aria-hidden
      className="bot-typing-dots inline-flex items-center gap-1"
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1.5 rounded-full bg-current"
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
    </span>
  );
}
