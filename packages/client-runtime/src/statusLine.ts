import type {
  ModelSelection,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import { collectProviderUsageLimits } from "@t3tools/shared/usageLimits";

import type { ContextWindowSnapshot } from "./state/contextWindow.ts";
import { REASONING_EFFORT_OPTION_IDS } from "./state/threadExecution.ts";

export interface StatusLineInputSource {
  readonly threadId: string;
  readonly cwd: string | null;
  readonly modelSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly usageLimitSources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
  /** Usage limits are read as of this time. */
  readonly nowMs: number;
}

function usageWindows(source: StatusLineInputSource): ReadonlyArray<ServerProviderUsageWindow> {
  const instanceId = source.modelSelection?.instanceId;
  if (instanceId === undefined) return [];
  const providers = [...source.providers];
  const report = collectProviderUsageLimits(
    instanceId,
    providers,
    source.usageLimitSources,
    source.nowMs,
  );
  // Another account in the report may be a different login, so only this instance's entry counts.
  const limits =
    report?.accounts.find((entry) => entry.instanceId === instanceId)?.limits ??
    providers.find((provider) => provider.instanceId === instanceId)?.usageLimits;
  return limits?.unavailable === undefined ? (limits?.windows ?? []) : [];
}

function rateLimit(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
  kind: ServerProviderUsageWindow["kind"],
) {
  const matching = windows.filter((window) => window.kind === kind);
  const window = matching.find((candidate) => candidate.modelIds === undefined) ?? matching[0];
  if (window === undefined) return undefined;
  const resetsAt = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  return {
    used_percentage: Math.round(window.usedPercent),
    ...(Number.isFinite(resetsAt) ? { resets_at: Math.floor(resetsAt / 1000) } : {}),
  };
}

/** Claude Code's status line JSON, so scripts written for it run unchanged. Unknown fields are left out. */
export function buildStatusLineInput(source: StatusLineInputSource): Record<string, unknown> {
  const selection = source.modelSelection;
  const provider =
    selection === null
      ? undefined
      : source.providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === selection?.model);
  const displayName = (model?.name ?? selection?.model)?.replace(/^Claude\s+/i, "");
  const effort = REASONING_EFFORT_OPTION_IDS.map((id) =>
    getModelSelectionStringOptionValue(selection, id),
  ).find(Boolean);
  const fastMode = getModelSelectionBooleanOptionValue(selection, "fastMode");
  const context = source.contextWindow;
  const windows = usageWindows(source);
  const fiveHour = rateLimit(windows, "session");
  const sevenDay = rateLimit(windows, "weekly");
  const inputTokens = context?.inputTokens ?? null;
  const cachedInputTokens = context?.cachedInputTokens ?? null;

  return {
    session_id: source.threadId,
    ...(source.cwd === null
      ? {}
      : { cwd: source.cwd, workspace: { current_dir: source.cwd, project_dir: source.cwd } }),
    ...(selection === null ? {} : { model: { id: selection.model, display_name: displayName } }),
    ...(effort === undefined ? {} : { effort: { level: effort } }),
    ...(fastMode === undefined ? {} : { fast_mode: fastMode }),
    ...(provider?.version ? { version: provider.version } : {}),
    ...(context === null
      ? {}
      : {
          context_window: {
            ...(context.maxTokens === null ? {} : { context_window_size: context.maxTokens }),
            ...(context.usedPercentage === null
              ? {}
              : { used_percentage: Math.round(context.usedPercentage) }),
            ...(context.remainingPercentage === null
              ? {}
              : { remaining_percentage: Math.round(context.remainingPercentage) }),
            current_usage: { input_tokens: context.usedTokens },
            ...(inputTokens === null ? {} : { total_input_tokens: inputTokens }),
            ...(context.outputTokens === null ? {} : { total_output_tokens: context.outputTokens }),
          },
          ...(inputTokens !== null && inputTokens > 0 && cachedInputTokens !== null
            ? { prompt_cache: { hit_ratio: Math.min(1, cachedInputTokens / inputTokens) } }
            : {}),
        }),
    ...(fiveHour === undefined && sevenDay === undefined
      ? {}
      : {
          rate_limits: {
            ...(fiveHour === undefined ? {} : { five_hour: fiveHour }),
            ...(sevenDay === undefined ? {} : { seven_day: sevenDay }),
          },
        }),
  };
}

/** The clock-driven fields, added when the line is drawn so a stable input can key its refresh. */
export function stampStatusLineInput(
  input: Record<string, unknown>,
  createdAt: string | null,
  nowMs: number,
): Record<string, unknown> {
  const started = createdAt === null ? Number.NaN : Date.parse(createdAt);
  return Number.isFinite(started)
    ? { ...input, cost: { total_duration_ms: Math.max(0, nowMs - started) } }
    : input;
}

export interface AnsiSegment {
  readonly text: string;
  /** A CSS color, or null for the default foreground. */
  readonly color: string | null;
  readonly background: string | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

const BASE_COLORS = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];
// White and black would vanish on one theme or the other, so they take the theme's foreground.
const THEME_FOREGROUND_INDEXES = new Set([0, 7, 15]);

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function xterm256Color(index: number): string | null {
  if (THEME_FOREGROUND_INDEXES.has(index)) return null;
  if (index < 16) return BASE_COLORS[index] ?? null;
  if (index < 232) {
    const cube = index - 16;
    const level = (step: number) => (step === 0 ? 0 : 55 + step * 40);
    return `#${hex(level(Math.floor(cube / 36)))}${hex(level(Math.floor(cube / 6) % 6))}${hex(level(cube % 6))}`;
  }
  if (index < 256) {
    const gray = 8 + (index - 232) * 10;
    return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
  }
  return null;
}

interface AnsiStyle {
  color: string | null;
  background: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const RESET_STYLE: AnsiStyle = {
  color: null,
  background: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

function extendedColor(codes: ReadonlyArray<number>, index: number): [string | null, number] {
  if (codes[index + 1] === 5) return [xterm256Color(codes[index + 2] ?? -1), index + 2];
  if (codes[index + 1] === 2) {
    const [r = 0, g = 0, b = 0] = codes.slice(index + 2, index + 5);
    return [`#${hex(r & 255)}${hex(g & 255)}${hex(b & 255)}`, index + 4];
  }
  return [null, index];
}

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((part) => Number(part) || 0);
  let next = { ...style };
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;
    if (code === 0) next = { ...RESET_STYLE };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.color = xterm256Color(code - 30);
    else if (code >= 90 && code <= 97) next.color = xterm256Color(code - 82);
    else if (code === 39) next.color = null;
    else if (code >= 40 && code <= 47) next.background = xterm256Color(code - 40);
    else if (code >= 100 && code <= 107) next.background = xterm256Color(code - 92);
    else if (code === 49) next.background = null;
    else if (code === 38 || code === 48) {
      const [color, end] = extendedColor(codes, index);
      if (code === 38) next.color = color;
      else next.background = color;
      index = end;
    }
  }
  return next;
}

// SGR sequences style text; every other escape (cursor moves, OSC titles and links) is dropped.
const ESCAPE_PATTERN =
  /\u001b\[([0-9;:]*)m|\u001b\[[0-9;:?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b./g;

/** Splits terminal output into styled lines, the way a terminal would draw Claude Code's status line. */
export function parseAnsiLines(text: string): ReadonlyArray<ReadonlyArray<AnsiSegment>> {
  const lines: AnsiSegment[][] = [];
  let style = RESET_STYLE;
  for (const line of text.split(/\r?\n/)) {
    const segments: AnsiSegment[] = [];
    let cursor = 0;
    const push = (value: string) => {
      if (value === "") return;
      const last = segments.at(-1);
      if (
        last !== undefined &&
        last.color === style.color &&
        last.background === style.background &&
        last.bold === style.bold &&
        last.dim === style.dim &&
        last.italic === style.italic &&
        last.underline === style.underline
      ) {
        segments[segments.length - 1] = { ...last, text: last.text + value };
      } else {
        segments.push({ text: value, ...style });
      }
    };
    for (const match of line.matchAll(ESCAPE_PATTERN)) {
      push(line.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      if (match[1] !== undefined) style = applySgr(style, match[1]);
    }
    push(line.slice(cursor));
    lines.push(segments);
  }
  while (lines.length > 0 && lines.at(-1)?.length === 0) lines.pop();
  return lines;
}
