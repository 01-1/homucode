import type { DesktopStagedBuildsState, DesktopStagedBuildUndoResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export class DesktopStagedBuildsError extends Schema.TaggedError<DesktopStagedBuildsError>()(
  "DesktopStagedBuildsError",
  { message: Schema.String },
) {}

// The same files a launcher's `ls -t T3-Code-*.AppImage | head -n1` picks from.
const isLaunchable = (name: string) => name.startsWith("T3-Code-") && name.endsWith(".AppImage");
const UNDONE_NAME = /^(T3-Code-.+\.AppImage)\.off(?:-\d+)?$/;

/**
 * Undo renames the build the next start would load, so the one staged before it loads instead.
 * Renaming keeps mtimes, so redo makes the build the newest again.
 */
export class DesktopStagedBuilds extends Context.Service<
  DesktopStagedBuilds,
  {
    readonly state: Effect.Effect<DesktopStagedBuildsState | null, DesktopStagedBuildsError>;
    readonly undo: Effect.Effect<DesktopStagedBuildUndoResult, DesktopStagedBuildsError>;
    readonly redo: (
      undoneAs: string,
    ) => Effect.Effect<DesktopStagedBuildsState, DesktopStagedBuildsError>;
  }
>()("@t3tools/desktop/app/DesktopStagedBuilds") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = environment.path;
  const fail = (message: string) => new DesktopStagedBuildsError({ message });
  const taken = (folder: string, name: string) =>
    fileSystem.exists(path.join(folder, name)).pipe(Effect.orElseSucceed(() => true));

  // An AppImage run with APPIMAGE_EXTRACT_AND_RUN=1 leaves APPIMAGE unset; its runtime is our parent.
  const runningAppImage = Effect.gen(function* () {
    if (Option.isSome(environment.appImagePath)) return environment.appImagePath;
    if (environment.platform !== "linux") return Option.none<string>();
    const exe = yield* fileSystem
      .readLink(`/proc/${process.ppid}/exe`)
      .pipe(Effect.option, Effect.map(Option.map((target) => target.replace(/ \(deleted\)$/, ""))));
    return Option.filter(exe, (target) => path.basename(target).includes(".AppImage"));
  });

  const read = Effect.gen(function* () {
    const running = yield* runningAppImage;
    if (Option.isNone(running)) return null;
    const folder = path.dirname(running.value);
    const names = yield* fileSystem
      .readDirectory(folder)
      .pipe(Effect.mapError(() => fail(`Could not read ${folder}.`)));
    const builds = yield* Effect.forEach(names.filter(isLaunchable), (name) =>
      fileSystem.stat(path.join(folder, name)).pipe(
        Effect.map((info) => ({
          name,
          mtime: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
        })),
        Effect.option,
      ),
    );
    const newestFirst = builds
      .flatMap((build) => Option.toArray(build))
      .toSorted((left, right) => right.mtime - left.mtime);
    return {
      folder,
      running: path.basename(running.value),
      next: newestFirst[0]?.name ?? null,
      previous: newestFirst[1]?.name ?? null,
    } satisfies DesktopStagedBuildsState;
  });

  const state = read.pipe(Effect.withSpan("DesktopStagedBuilds.state"));

  const undo = Effect.fn("DesktopStagedBuilds.undo")(function* () {
    const current = yield* read;
    if (current === null) return yield* fail("This app is not running from an AppImage.");
    if (current.next === null || current.previous === null) {
      return yield* fail("There is no earlier build to go back to.");
    }
    let undoneAs = `${current.next}.off`;
    for (let suffix = 1; yield* taken(current.folder, undoneAs); suffix++) {
      undoneAs = `${current.next}.off-${suffix}`;
    }
    yield* fileSystem
      .rename(path.join(current.folder, current.next), path.join(current.folder, undoneAs))
      .pipe(Effect.mapError(() => fail(`Could not rename ${current.next}.`)));
    return { state: (yield* read) ?? current, undoneAs };
  });

  const redo = Effect.fn("DesktopStagedBuilds.redo")(function* (undoneAs: string) {
    const current = yield* read;
    if (current === null) return yield* fail("This app is not running from an AppImage.");
    const original = UNDONE_NAME.exec(undoneAs)?.[1];
    if (original === undefined || undoneAs !== path.basename(undoneAs)) {
      return yield* fail(`${undoneAs} is not an undone build.`);
    }
    if (yield* taken(current.folder, original)) return yield* fail(`${original} already exists.`);
    yield* fileSystem
      .rename(path.join(current.folder, undoneAs), path.join(current.folder, original))
      .pipe(Effect.mapError(() => fail(`Could not restore ${original}.`)));
    return (yield* read) ?? current;
  });

  return DesktopStagedBuilds.of({ state, undo: undo(), redo });
});

export const layer = Layer.effect(DesktopStagedBuilds, make);
