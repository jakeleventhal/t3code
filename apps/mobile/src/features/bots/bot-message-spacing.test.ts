import { expect, it } from "vite-plus/test";
import { botMessageTimeMarkers } from "./bot-message-spacing";

it("groups a conversation and inserts a timestamp only after a five-minute gap", () => {
  const rows = [
    { id: "first", type: "message", createdAt: "2026-10-27T07:00:00Z" },
    { id: "reply", type: "message", createdAt: "2026-10-27T07:00:15Z" },
    { id: "followup", type: "message", createdAt: "2026-10-27T07:05:14Z" },
    { id: "thinking", type: "thinking", createdAt: "2026-10-27T07:10:00Z" },
    { id: "later", type: "message", createdAt: "2026-10-27T07:10:14Z" },
  ];
  expect([...botMessageTimeMarkers(rows)]).toEqual(["first", "later"]);
});

it("starts a new block across local midnight and ignores invalid timestamps", () => {
  const rows = [
    { id: "first", type: "message", createdAt: new Date(2026, 9, 26, 23, 59).toISOString() },
    { id: "bad", type: "message", createdAt: "invalid" },
    { id: "tomorrow", type: "message", createdAt: new Date(2026, 9, 27, 0, 1).toISOString() },
  ];
  expect([...botMessageTimeMarkers(rows)]).toEqual(["first", "tomorrow"]);
});
