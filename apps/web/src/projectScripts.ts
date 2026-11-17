import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  BASH_SCRIPT_COMMAND_PATTERN,
  BASH_SCRIPT_COMMAND_PREFIX,
  type KeybindingCommand,
  type ProjectScript,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);
const isBashScriptCommand = Schema.is(BASH_SCRIPT_COMMAND_PATTERN);

export interface ProjectScriptInput {
  readonly name: ProjectScript["name"];
  readonly command: ProjectScript["command"];
  readonly icon: ProjectScript["icon"];
  readonly runOnWorktreeCreate: ProjectScript["runOnWorktreeCreate"];
  readonly waitForSetup: boolean;
  readonly runOnSettle: boolean;
  readonly stopOnSettle?: boolean;
  readonly previewUrl: Exclude<ProjectScript["previewUrl"], undefined> | null;
  readonly autoOpenPreview: boolean;
}

export function buildProjectScript(id: string, input: ProjectScriptInput): ProjectScript {
  return {
    id,
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    ...(input.runOnWorktreeCreate && input.waitForSetup ? { async: false } : {}),
    ...(input.runOnSettle ? { runOnSettle: true } : {}),
    ...(input.stopOnSettle ? { stopOnSettle: true } : {}),
    ...(input.previewUrl === null
      ? {}
      : {
          previewUrl: input.previewUrl,
          autoOpenPreview: input.autoOpenPreview,
        }),
  };
}

export function releaseClaimedRoles(
  script: ProjectScript,
  saved: ProjectScriptInput,
): ProjectScript {
  const releaseSetup = saved.runOnWorktreeCreate && script.runOnWorktreeCreate;
  const releaseSettle = saved.runOnSettle && script.runOnSettle === true;
  if (!releaseSetup && !releaseSettle) return script;
  return {
    ...script,
    ...(releaseSetup ? { runOnWorktreeCreate: false } : {}),
    ...(releaseSettle ? { runOnSettle: false } : {}),
  };
}

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export function commandForProjectScript(scriptId: string): KeybindingCommand | null {
  const command = `script.${scriptId}.run`;
  return isScriptRunCommand(command) ? command : null;
}

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!isScriptRunCommand(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export type CustomScriptLanguage = "bash" | "ts";

export interface CustomScript {
  readonly language: CustomScriptLanguage;
  readonly source: string;
}

/** TS bindings wait for app scripts, which will add a `ts:` command and run it in the app window. */
export function isCustomScriptLanguageAvailable(language: CustomScriptLanguage): boolean {
  return language === "bash";
}

/** Null when the source is invalid or its language cannot be bound yet. */
export function commandForCustomScript(script: CustomScript): KeybindingCommand | null {
  if (script.language !== "bash") return null;
  const command = `${BASH_SCRIPT_COMMAND_PREFIX}${script.source.trim()}`;
  return isBashScriptCommand(command) ? command : null;
}

export function customScriptFromCommand(command: string): CustomScript | null {
  return isBashScriptCommand(command)
    ? { language: "bash", source: command.slice(BASH_SCRIPT_COMMAND_PREFIX.length).trim() }
    : null;
}

/** Commands that run in the active thread's terminal, so they resolve from that thread's machine. */
export function isThreadScriptCommand(command: string): boolean {
  return projectScriptIdFromCommand(command) !== null || isBashScriptCommand(command);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function primaryProjectScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  const regular = scripts.find((script) => !script.runOnWorktreeCreate && !script.runOnSettle);
  return regular ?? scripts.find((script) => !script.runOnSettle) ?? null;
}
