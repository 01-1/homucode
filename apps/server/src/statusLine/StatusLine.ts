import type { StatusLineRenderInput, StatusLineRenderResult } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import { BUILT_IN_STATUS_LINE_SCRIPT } from "./builtInScript.ts";

const TIMEOUT = "5 seconds";
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ERROR_LENGTH = 500;

export class StatusLine extends Context.Service<
  StatusLine,
  {
    /** Runs the configured status line command with Claude Code's JSON on stdin. */
    readonly render: (input: StatusLineRenderInput) => Effect.Effect<StatusLineRenderResult>;
  }
>()("t3/statusLine/StatusLine") {}

const invocation = Effect.fnUntraced(function* (command: string) {
  if (command === "") return { command: "bash", args: ["-c", BUILT_IN_STATUS_LINE_SCRIPT] };
  if ((yield* HostProcess.Platform) === "win32") {
    const comSpec = (yield* HostProcess.Environment).ComSpec;
    return { command: comSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { command: "/bin/sh", args: ["-c", command] };
});

function workspaceDirectory(input: StatusLineRenderInput["input"]): string | null {
  const workspace = input.workspace;
  const dir =
    typeof workspace === "object" && workspace !== null && "current_dir" in workspace
      ? workspace.current_dir
      : input.cwd;
  return typeof dir === "string" && dir !== "" ? dir : null;
}

function lastLines(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_ERROR_LENGTH ? trimmed.slice(-MAX_ERROR_LENGTH) : trimmed;
}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;

  const render = Effect.fn("StatusLine.render")(function* ({ input }: StatusLineRenderInput) {
    const current = yield* settings.getSettings.pipe(Effect.option);
    if (current._tag === "None" || !current.value.statusLineEnabled) return { text: "" };
    const requested = workspaceDirectory(input);
    const isDirectory =
      requested === null
        ? false
        : yield* fs.stat(requested).pipe(
            Effect.map((info) => info.type === "Directory"),
            Effect.orElseSucceed(() => false),
          );
    const spawn = yield* invocation(current.value.statusLineCommand);
    return yield* runner
      .run({
        ...spawn,
        cwd: isDirectory && requested !== null ? requested : yield* HostProcess.HomeDirectory,
        stdin: JSON.stringify(input),
        ignoreStdinErrors: true,
        timeout: TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((output): StatusLineRenderResult => {
          const text = output.stdout.replace(/\s+$/, "");
          if (output.code === 0) return { text };
          const error = lastLines(output.stderr) || `Exited with code ${String(output.code)}`;
          return { text, error };
        }),
        Effect.catch((error) => Effect.succeed({ text: "", error: error.message })),
      );
  });

  return StatusLine.of({ render });
});

export const layer = Layer.effect(StatusLine, make);
