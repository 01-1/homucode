import { DesktopStagedBuildsStateSchema } from "./ipc.ts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

export const BuildToolsRequest = Schema.Struct({
  action: Schema.Literals([
    "cloud-build",
    "cloud-test",
    "android",
    "load",
    "serve",
    "stop-serving",
    "undo",
    "redo",
  ]),
  ref: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("origin/main"))),
  testFiles: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  stagedFile: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  undoneAs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  sha256: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type BuildToolsRequest = typeof BuildToolsRequest.Type;

export const BuildToolsState = Schema.Struct({
  stagedBuilds: Schema.NullOr(DesktopStagedBuildsStateSchema),
  undoneAs: Schema.NullOr(Schema.String),
  phase: Schema.Literals(["idle", "running", "completed", "failed"]),
  message: Schema.String,
  output: Schema.String,
  artifactPath: Schema.NullOr(Schema.String),
  lanUrl: Schema.NullOr(Schema.String),
  appImageAvailable: Schema.Boolean,
  buildFolder: Schema.String,
  backgroundGitEnabled: Schema.Boolean,
  backgroundGitOverridden: Schema.Boolean,
});
export type BuildToolsState = typeof BuildToolsState.Type;

export class BuildToolsError extends Schema.TaggedError<BuildToolsError>()("BuildToolsError", {
  reason: Schema.Literals([
    "disabled",
    "busy",
    "unavailable",
    "invalid-input",
    "process",
    "storage",
  ]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "disabled":
        return "Enable this build tool in Settings first.";
      case "busy":
        return "A build operation is already running.";
      case "unavailable":
        return "This tool is not available on this installation. Check the checkout, Python, launcher and boat CLI; sign in with boat login.";
      case "invalid-input":
        return "Choose a committed ref, or a staged AppImage and its SHA-256 checksum.";
      case "process":
        return "The build tool failed. Check its status and logs.";
      case "storage":
        return "Could not read or write the build tool files.";
    }
  }
}
