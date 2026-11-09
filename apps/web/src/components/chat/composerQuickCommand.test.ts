import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveQuickCommandSend } from "./composerQuickCommand";

const claude = (model: string) => ({ instanceId: ProviderInstanceId.make("claude"), model });
const quick = claude("claude-haiku-5-5");
const send = (
  prompt: string,
  overrides: Partial<Parameters<typeof resolveQuickCommandSend>[0]> = {},
) =>
  resolveQuickCommandSend({
    prompt,
    quickModelSelection: quick,
    threadStarted: true,
    ...overrides,
  });

describe("resolveQuickCommandSend", () => {
  it("sends only the question, on the quick model", () => {
    expect(send("/q  what changed?")).toEqual({
      kind: "send",
      question: "what changed?",
      modelSelection: quick,
    });
  });

  it("sends on a quick model from another provider too", () => {
    const luna = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
    expect(send("/q hi", { quickModelSelection: luna })).toMatchObject({
      kind: "send",
      modelSelection: luna,
    });
  });

  it("leaves other messages to the thread's model", () => {
    expect(send("what changed?")).toEqual({ kind: "none" });
    expect(send("/quit")).toEqual({ kind: "none" });
  });

  it.each([
    ["an empty question", "/q", {}, "Nothing to ask"],
    ["no quick model", "/q hi", { quickModelSelection: null }, "No quick model"],
    ["a thread that has not started", "/q hi", { threadStarted: false }, "Start the thread first"],
  ] as const)("refuses %s", (_case, prompt, overrides, title) => {
    expect(send(prompt, overrides)).toMatchObject({ kind: "blocked", title });
  });
});
