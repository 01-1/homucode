import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { ContextWindowSnapshot } from "./state/contextWindow.ts";
import { buildStatusLineInput, parseAnsiLines, stampStatusLineInput } from "./statusLine.ts";

const plain = { background: null, bold: false, dim: false, italic: false, underline: false };

describe("parseAnsiLines", () => {
  it("styles text the way the 01-1/statusline script colors it", () => {
    const text = "\u001b[38;5;15m~/code \u001b[38;5;183mi@o\u001b[38;5;8m |\u001b[0m";
    expect(parseAnsiLines(text)).toEqual([
      [
        { text: "~/code ", color: null, ...plain },
        { text: "i@o", color: "#d7afff", ...plain },
        { text: " |", color: "#808080", ...plain },
      ],
    ]);
  });

  it("handles basic, truecolor, attributes, and resets", () => {
    expect(parseAnsiLines("\u001b[1;31mred\u001b[22;38;2;1;2;3mrgb\u001b[39;4mu\u001b[mx")).toEqual(
      [
        [
          { text: "red", color: "#cd0000", ...plain, bold: true },
          { text: "rgb", color: "#010203", ...plain },
          { text: "u", color: null, ...plain, underline: true },
          { text: "x", color: null, ...plain },
        ],
      ],
    );
  });

  it("carries style across lines and drops other escapes", () => {
    expect(
      parseAnsiLines(
        "\u001b]0;title\u0007\u001b[32mone\u001b[2K\ntwo\u001b]8;;https://x\u001b\\\n\n",
      ),
    ).toEqual([
      [{ text: "one", color: "#00cd00", ...plain }],
      [{ text: "two", color: "#00cd00", ...plain }],
    ]);
  });
});

const context: ContextWindowSnapshot = {
  usedTokens: 341_000,
  totalProcessedTokens: null,
  maxTokens: 1_000_000,
  remainingTokens: 659_000,
  usedPercentage: 34.1,
  remainingPercentage: 65.9,
  inputTokens: 338_000,
  cachedInputTokens: 334_620,
  outputTokens: 21_400,
  reasoningOutputTokens: null,
  lastUsedTokens: null,
  lastInputTokens: null,
  lastCachedInputTokens: null,
  lastOutputTokens: null,
  lastReasoningOutputTokens: null,
  toolUses: null,
  durationMs: null,
  compactsAutomatically: true,
  autoCompactThreshold: null,
  cost: null,
  updatedAt: "2026-11-16T00:00:00.000Z",
};

describe("buildStatusLineInput", () => {
  it("maps a thread onto Claude Code's status line fields", () => {
    const input = stampStatusLineInput(
      buildStatusLineInput({
        threadId: "thread-1",
        cwd: "/home/vi/code",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-5-5",
          options: [
            { id: "effort", value: "high" },
            { id: "fastMode", value: false },
          ],
        },
        providers: [
          {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            driver: ProviderDriverKind.make("claudeAgent"),
            status: "ready",
            enabled: true,
            installed: true,
            auth: { status: "authenticated" },
            checkedAt: "2026-11-16T00:00:00.000Z",
            version: "2.1.311",
            models: [
              {
                slug: "claude-opus-5-5",
                name: "Claude Opus 5.5",
                isCustom: false,
                capabilities: null,
              },
            ],
            slashCommands: [],
            skills: [],
            usageLimits: {
              checkedAt: "2026-11-16T00:00:00.000Z",
              windows: [
                {
                  id: "weekly-fable",
                  kind: "weekly",
                  label: "Fable",
                  modelIds: ["claude-fable-5-2"],
                  usedPercent: 90,
                },
                {
                  id: "session",
                  kind: "session",
                  label: "5h",
                  usedPercent: 47.4,
                  resetsAt: "2026-11-16T02:01:00.000Z",
                },
                { id: "weekly", kind: "weekly", label: "7d", usedPercent: 43 },
              ],
            },
          },
        ],
        usageLimitSources: [],
        contextWindow: context,
        nowMs: Date.parse("2026-11-16T00:48:31.000Z"),
      }),
      "2026-11-16T00:00:00.000Z",
      Date.parse("2026-11-16T00:48:31.000Z"),
    );
    expect(input).toEqual({
      session_id: "thread-1",
      cwd: "/home/vi/code",
      workspace: { current_dir: "/home/vi/code", project_dir: "/home/vi/code" },
      model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
      effort: { level: "high" },
      fast_mode: false,
      version: "2.1.311",
      cost: { total_duration_ms: 2_911_000 },
      context_window: {
        context_window_size: 1_000_000,
        used_percentage: 34,
        remaining_percentage: 66,
        current_usage: { input_tokens: 341_000 },
        total_input_tokens: 338_000,
        total_output_tokens: 21_400,
      },
      prompt_cache: { hit_ratio: 0.99 },
      rate_limits: {
        five_hour: {
          used_percentage: 47,
          resets_at: Date.parse("2026-11-16T02:01:00.000Z") / 1000,
        },
        seven_day: { used_percentage: 43 },
      },
    });
  });
});
