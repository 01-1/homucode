import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});

describe("buildThreadTitlePrompt", () => {
  const scheme = 'Title every thread "First Last: what it does (model effort)".';

  it("lets the user's title instructions override the word and length limits", () => {
    for (const previousTitle of [undefined, "Old title"]) {
      const { prompt } = buildThreadTitlePrompt({
        message: "Relay chat messages to the lead agent",
        previousTitle,
        instructions: scheme,
      });
      expect(prompt).toContain(scheme);
      expect(prompt).toMatch(/conflict with the editorial rules above.*follow these instead/);
      expect(prompt.indexOf(scheme)).toBeGreaterThan(prompt.indexOf("Editorial rules:"));
    }
  });

  it("adds nothing when there are no instructions", () => {
    const { prompt } = buildThreadTitlePrompt({ message: "Fix the login bug", instructions: "  " });
    expect(prompt).not.toContain("follow these instead");
  });
});
