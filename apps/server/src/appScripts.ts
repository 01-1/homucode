// @effect-diagnostics nodeBuiltinImport:off -- Node's own TypeScript stripper keeps a compiler out of every bundle.
import * as NodeModule from "node:module";

import {
  APP_SCRIPT_TYPE_DEFINITIONS,
  APP_SCRIPT_TYPES_FILE_NAME,
  APP_SCRIPTS_DIRECTORY_NAME,
  AppScriptLoadError,
  type AppScriptLoadInput,
  type AppScriptLoadResult,
  MAX_APP_SCRIPT_SOURCE_BYTES,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "./config.ts";

/** Removes erasable TypeScript syntax; enums and namespaces are rejected rather than compiled. */
export function stripAppScriptTypes(source: string): string {
  return NodeModule.stripTypeScriptTypes(source, { mode: "strip" });
}

export class AppScripts extends Context.Service<
  AppScripts,
  {
    readonly load: (
      input: AppScriptLoadInput,
    ) => Effect.Effect<AppScriptLoadResult, AppScriptLoadError>;
  }
>()("t3/appScripts/AppScripts") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(config.stateDir, APP_SCRIPTS_DIRECTORY_NAME);
  const typesPath = path.join(directory, APP_SCRIPT_TYPES_FILE_NAME);

  // Keeps the editor types beside the scripts current with this version. Best effort.
  const refreshTypes = fileSystem.readFileString(typesPath).pipe(
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((current) =>
      current === APP_SCRIPT_TYPE_DEFINITIONS
        ? Effect.void
        : fileSystem.writeFileString(typesPath, APP_SCRIPT_TYPE_DEFINITIONS),
    ),
    Effect.ignore,
  );

  const load = Effect.fn("AppScripts.load")(function* (input: AppScriptLoadInput) {
    const scriptPath = path.join(directory, `${input.name}.ts`);
    const failure = (reason: AppScriptLoadError["reason"], detail?: string) =>
      new AppScriptLoadError({
        reason,
        path: scriptPath,
        ...(detail === undefined ? {} : { detail }),
      });
    const info = yield* fileSystem
      .stat(scriptPath)
      .pipe(
        Effect.mapError((error) =>
          failure(error.reason._tag === "NotFound" ? "not-found" : "read-failed"),
        ),
      );
    if (info.type !== "File") return yield* failure("not-found");
    if (Number(info.size) > MAX_APP_SCRIPT_SOURCE_BYTES) return yield* failure("too-large");
    const source = yield* fileSystem
      .readFileString(scriptPath)
      .pipe(Effect.mapError(() => failure("read-failed")));
    yield* refreshTypes;
    const code = yield* Effect.try({
      try: () => stripAppScriptTypes(source),
      catch: (cause) =>
        failure("invalid-typescript", cause instanceof Error ? cause.message : String(cause)),
    });
    return { code, path: scriptPath };
  });

  return AppScripts.of({ load });
});

export const layer = Layer.effect(AppScripts, make);
