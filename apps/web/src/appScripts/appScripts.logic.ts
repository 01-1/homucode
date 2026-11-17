import { APP_SCRIPT_RUN_COMMAND_PATTERN, MAX_APP_SCRIPT_OUTPUT_LENGTH } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isAppScriptRunCommand = Schema.is(APP_SCRIPT_RUN_COMMAND_PATTERN);

/** `user.<name>.run` → `<name>`. */
export function appScriptNameFromCommand(command: string): string | null {
  return isAppScriptRunCommand(command) ? command.slice("user.".length, -".run".length) : null;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Scripts run only in a window on the machine whose scripts folder they come from: the desktop
 * app, or a browser opened on that machine. A browser reaching T3 Code over the network does not.
 */
export function isLocalAppWindow(input: {
  readonly electron: boolean;
  readonly hostname: string;
}): boolean {
  return input.electron || LOOPBACK_HOSTNAMES.has(input.hostname);
}

/** A script's return value as the terminal prints it: JSON, cut to the protocol's limit. */
export function appScriptOutput(value: unknown): string | null {
  if (value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_APP_SCRIPT_OUTPUT_LENGTH
    ? `${text.slice(0, MAX_APP_SCRIPT_OUTPUT_LENGTH)}…`
    : text;
}
