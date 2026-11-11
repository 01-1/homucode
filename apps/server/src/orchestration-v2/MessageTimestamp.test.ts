import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { withMessageTimestamp } from "./MessageTimestamp.ts";

const createdAt = DateTime.makeUnsafe("2026-11-10T22:49:34.987Z");

describe("provider message timestamps", () => {
  it("uses the original creation time in local wall-clock seconds, once on the first line", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const message = { text: "Hello\nsecond line", createdAt };
      const providerText = withMessageTimestamp(message.text, message);
      expect(providerText).toBe("2026-11-10T17:49:34: Hello\nsecond line");
      expect(withMessageTimestamp(providerText, message)).toBe(providerText);
      expect(message.text).toBe("Hello\nsecond line");
      expect(withMessageTimestamp("context\n\nUser message:\nHello", message)).toBe(
        "2026-11-10T17:49:34: context\n\nUser message:\nHello",
      );
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it.each([
    "/compact",
    "/goal ship it",
    "  /skill args",
    "$review src",
    "€review src",
    "  $skill args",
  ])("leaves %s verbatim", (text) => {
    expect(withMessageTimestamp(text, { text, createdAt })).toBe(text);
  });
});
