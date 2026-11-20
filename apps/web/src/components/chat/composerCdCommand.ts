import { m } from "~/i18n/messages";
import { msg } from "gt-react";
import { resolveProjectPathForDispatch } from "@t3tools/client-runtime/state/projects";
import { parseCdCommand } from "@t3tools/shared/composerTrigger";

export type CdCommand =
  | { readonly kind: "none" }
  | { readonly kind: "blocked"; readonly title: string; readonly description: string }
  | { readonly kind: "cd"; readonly path: string };

const isAbsoluteOrHome = (path: string) =>
  path.startsWith("/") || path.startsWith("~") || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path);

/**
 * What a send does with a `/cd` message. A relative folder is taken from the thread's current
 * folder; `~` is left for the server, which owns the home directory.
 */
export function resolveCdCommand(input: {
  readonly prompt: string;
  readonly cwd: string | null;
}): CdCommand {
  const command = parseCdCommand(input.prompt);
  if (command === null) return { kind: "none" };
  const path = command.path.replace(/^(["'])(.*)\1$/, "$2");
  if (path === "") {
    return {
      kind: "blocked",
      title: m(msg("No folder")),
      description: m(msg("Type a folder after /cd.")),
    };
  }
  if (isAbsoluteOrHome(path)) return { kind: "cd", path };
  if (input.cwd === null) {
    return {
      kind: "blocked",
      title: m(msg("No current folder")),
      description: m(msg("Use a full path: this thread has no folder to start from.")),
    };
  }
  const relative = /^\.\.?(?:[\\/]|$)/.test(path) ? `${path}/` : `./${path}`;
  return { kind: "cd", path: resolveProjectPathForDispatch(relative, input.cwd) };
}
