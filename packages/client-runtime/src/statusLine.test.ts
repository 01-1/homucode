import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ContextWindowSnapshot } from "./state/contextWindow.ts";
import {
  buildStatusLineInput,
  expandStatusLineLabel,
  parseAnsiLines,
  stampStatusLineInput,
  statusLineColorRole,
  statusLineModelName,
  reserveStatusLineText,
  splitStatusLineItems,
} from "./statusLine.ts";

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

describe("statusLineColorRole", () => {
  it.each([
    ["#cd0000", "error"],
    ["#ff5f87", "error"],
    ["#cdcd00", "warning"],
    ["#ffaf00", "warning"],
    ["#00cd00", "success"],
    ["#00cdcd", "info"],
    ["#5c5cff", "info"],
    ["#d7afff", "accent"],
    ["#cd00cd", "accent"],
    ["#808080", "muted"],
    ["#d0d0d0", "foreground"],
    ["red", "foreground"],
  ] as const)("maps %s to %s", (color, role) => {
    expect(statusLineColorRole(color)).toBe(role);
  });
});

describe("splitStatusLineItems", () => {
  const muted = { color: "#808080", ...plain };
  const accent = { color: "#d7afff", ...plain };

  it("splits the built-in line into directory, items, and clock", () => {
    const [line = []] = parseAnsiLines(
      "\u001b[38;5;15m~/code/homucode \u001b[38;5;183mvi@pbox \u001b[38;5;8m| \u001b[38;5;183mO5.5\u001b[38;5;8m, up \u001b[38;5;183m1h02m [21:41:07] \u001b[38;5;8mcache \u001b[38;5;183m37%\u001b[38;5;8m, v\u001b[38;5;183m2.1",
    );
    expect(splitStatusLineItems(line)).toEqual([
      { kind: "directory", segments: [{ text: "~/code/homucode", color: null, ...plain }] },
      {
        kind: "text",
        segments: [
          { text: "vi@pbox", ...accent },
          { text: " ", ...accent },
          { text: "|", ...muted },
        ],
      },
      {
        kind: "text",
        segments: [
          { text: "O5.5", ...accent },
          { text: ",", ...muted },
        ],
      },
      {
        kind: "text",
        segments: [
          { text: "up ", ...muted },
          { text: "1h02m", ...accent },
          { text: ",", ...muted },
        ],
      },
      { kind: "clock", segments: [{ text: "[21:41:07]", ...accent }] },
      {
        kind: "text",
        segments: [
          { text: "cache ", ...muted },
          { text: "37%", ...accent },
          { text: ",", ...muted },
        ],
      },
      {
        kind: "text",
        segments: [
          { text: "v", ...muted },
          { text: "2.1", ...accent },
        ],
      },
    ]);
  });

  it("keeps a styled directory with spaces whole", () => {
    const [line = []] = parseAnsiLines("/repos/My Project \u001b[38;5;183mvi@pbox");
    expect(splitStatusLineItems(line).map((item) => [item.kind, item.segments[0]?.text])).toEqual([
      ["directory", "/repos/My Project"],
      ["text", "vi@pbox"],
    ]);
  });

  it("does not take a clock styled with the directory into the directory", () => {
    const [line = []] = parseAnsiLines("~/repo up 2h [12:34:56] \u001b[38;5;183mmain");
    expect(splitStatusLineItems(line).map((item) => item.kind)).toEqual([
      "directory",
      "text",
      "clock",
      "text",
    ]);
  });

  it("keeps a line without separators, directory, or clock as one item", () => {
    const line = [{ text: "A6 medium [1:2]", color: null, ...plain }];
    expect(splitStatusLineItems(line)).toEqual([{ kind: "text", segments: line }]);
  });

  it("gives each labelled value its own item", () => {
    const [line = []] = parseAnsiLines(
      "\u001b[38;5;118m+3 \u001b[38;5;8mcache \u001b[38;5;183m37%\u001b[38;5;8m, in \u001b[38;5;183m5k \u001b[38;5;8mout \u001b[38;5;183m6\u001b[38;5;8m, conx \u001b[38;5;46m8% \u001b[38;5;8m(\u001b[38;5;46m80k\u001b[38;5;8m)",
    );
    expect(splitStatusLineItems(line).map((item) => item.segments.map((s) => s.text))).toEqual([
      ["+3"],
      ["cache ", "37%", ","],
      ["in ", "5k"],
      ["out ", "6", ","],
      ["conx ", "8% ", "(", "80k", ")"],
    ]);
  });

  it("gives a clock at the end of an item no extra comma", () => {
    const line = [{ text: "up 5s [9:05], v2", color: null, ...plain }];
    expect(splitStatusLineItems(line).map((item) => item.segments.map((s) => s.text))).toEqual([
      ["up 5s", ","],
      ["[9:05]"],
      ["v2"],
    ]);
  });
});

describe("expandStatusLineLabel", () => {
  it("writes out a muted label and leaves other text alone", () => {
    expect(expandStatusLineLabel({ text: "conx ", color: "#808080", ...plain })).toBe("context ");
    expect(expandStatusLineLabel({ text: "v", color: "#808080", ...plain })).toBe("version ");
    expect(expandStatusLineLabel({ text: "), 5h ", color: "#808080", ...plain })).toBe(
      "), 5h limit ",
    );
    expect(expandStatusLineLabel({ text: "in ", color: "#d7afff", ...plain })).toBeNull();
    expect(expandStatusLineLabel({ text: "style ", color: "#808080", ...plain })).toBeNull();
  });
});

describe("reserveStatusLineText", () => {
  it.each([
    ["8%", "100%"],
    ["5s", "00h00m"],
    ["1d02h", "00h00m"],
    ["10m00s", "00h00m"],
    ["79.7k ", "000.0k "],
    ["(80k)", "(000k)"],
    ["6", "000.0k"],
    ["999", "000.0k"],
    ["1.0k", "000.0k"],
    ["+3 ", "+00 "],
    ["-120", "-120"],
    ["1234.5k", "1234.5k"],
    ["O5.5 medium", "O5.5 medium"],
    ["2.1.325", "2.1.325"],
    ["[21:41:07]", "[21:41:07]"],
  ])("reserves %s as %s", (text, reserved) => {
    expect(reserveStatusLineText({ text, color: "#d7afff", ...plain })).toBe(reserved);
  });

  it("leaves labels alone", () => {
    expect(reserveStatusLineText({ text: "5h ", color: "#808080", ...plain })).toBe("5h ");
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

describe("statusLineModelName", () => {
  it.each([
    ["Claude Opus 5.5", "Opus 5.5"],
    ["GPT-6.1-Sol", "Sol 6.1"],
    ["GPT-6-Astra", "Astra 6"],
    ["claude-fable-5-2", "fable 5 2"],
  ])("%s becomes %s", (name, expected) => {
    expect(statusLineModelName(name)).toBe(expected);
  });
});
