import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { conversationStatus } from "./repository";

describe("status operacional da conversa", () => {
  it.each(["new", "in_progress", "waiting_customer", "resolved"])("aceita %s", (status) => {
    expect(conversationStatus(status)).toBe(status);
  });

  it("recusa um status desconhecido", () => {
    expect(() => conversationStatus("archived")).toThrow(HttpError);
  });
});
