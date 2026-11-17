import type { DesktopStagedBuildsState, DesktopStagedBuildUndoResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import { makeStagedBuilds, StagedBuildsError } from "@t3tools/shared/stagedBuilds";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

/**
 * Undo renames the build the next start would load, so the one staged before it loads instead.
 * Renaming keeps mtimes, so redo makes the build the newest again.
 */
export class DesktopStagedBuilds extends Context.Service<
  DesktopStagedBuilds,
  {
    readonly state: Effect.Effect<DesktopStagedBuildsState | null, StagedBuildsError>;
    readonly undo: Effect.Effect<DesktopStagedBuildUndoResult, StagedBuildsError>;
    readonly redo: (undoneAs: string) => Effect.Effect<DesktopStagedBuildsState, StagedBuildsError>;
  }
>()("@t3tools/desktop/app/DesktopStagedBuilds") {}

export const resolveRunningAppImage = Effect.fn("desktop.stagedBuilds.resolveRunningAppImage")(
  function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (!environment.isPackaged || environment.platform !== "linux") return Option.none<string>();
    if (Option.isSome(environment.appImagePath)) return environment.appImagePath;
    const fileSystem = yield* FileSystem.FileSystem;
    // APPIMAGE_EXTRACT_AND_RUN leaves APPIMAGE unset; the desktop's parent is the runtime.
    const exe = yield* fileSystem
      .readLink(`/proc/${process.ppid}/exe`)
      .pipe(Effect.option, Effect.map(Option.map((target) => target.replace(/ \(deleted\)$/, ""))));
    return Option.filter(exe, (target) => environment.path.basename(target).endsWith(".AppImage"));
  },
);

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const path = environment.path;
  const running = yield* resolveRunningAppImage();

  return DesktopStagedBuilds.of(
    yield* makeStagedBuilds(Effect.succeed(running)).pipe(Effect.provideService(Path.Path, path)),
  );
});
export const layer = Layer.effect(DesktopStagedBuilds, make);
