import { describe, expect, it } from "vitest";
import type { FastifyReply } from "fastify";
import { appendVary } from "./vary.js";

// Enough of a reply to hold one header, which is all `appendVary` reads or
// writes.
const fakeReply = (initial?: number | string | string[]) => {
  let value = initial;
  return {
    reply: {
      getHeader: () => value,
      header: (_name: string, next: string) => {
        value = next;
      },
    } as unknown as FastifyReply,
    get vary() {
      return value;
    },
  };
};

describe("appendVary", () => {
  it("sets the header when nothing has written one yet", () => {
    const target = fakeReply();
    appendVary(target.reply, "Authorization", "X-Profile-Id");
    expect(target.vary).toBe("Authorization, X-Profile-Id");
  });

  it("keeps fields another hook already set", () => {
    // The regression: the caching hook used to replace the CORS hook's value,
    // so a cacheable response went out without `Vary: Origin`.
    const target = fakeReply("Origin");
    appendVary(target.reply, "Authorization", "X-Profile-Id");
    expect(target.vary).toBe("Origin, Authorization, X-Profile-Id");
  });

  it("does not repeat a field, whatever its case", () => {
    const target = fakeReply("origin, Authorization");
    appendVary(target.reply, "Origin", "X-Profile-Id");
    expect(target.vary).toBe("origin, Authorization, X-Profile-Id");
  });

  it("reads a comma-separated list and a repeated header alike", () => {
    const target = fakeReply(["Origin", "Accept-Encoding, Authorization"]);
    appendVary(target.reply, "X-Profile-Id");
    expect(target.vary).toBe("Origin, Accept-Encoding, Authorization, X-Profile-Id");
  });

  it("leaves a wildcard alone rather than narrowing it to a list", () => {
    const target = fakeReply("*");
    appendVary(target.reply, "Origin");
    expect(target.vary).toBe("*");
  });
});
