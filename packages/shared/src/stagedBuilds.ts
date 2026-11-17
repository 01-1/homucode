import type { DesktopStagedBuildsState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class StagedBuildsError extends Schema.TaggedError<StagedBuildsError>()(
  "DesktopStagedBuildsError",
  { message: Schema.String },
) {}
const isLaunchable = (name: string) => name.startsWith("T3-Code-") && name.endsWith(".AppImage");
const UNDONE_NAME = /^(T3-Code-.+\.AppImage)\.off(?:-\d+)?$/;

export const makeStagedBuilds = Effect.fn("StagedBuilds.make")(function* (
  runningAppImage: Effect.Effect<Option.Option<string>>,
  buildFolder: Effect.Effect<string | undefined> = Effect.undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fail = (message: string) => new StagedBuildsError({ message });
  const taken = (folder: string, name: string) =>
    fileSystem.exists(path.join(folder, name)).pipe(Effect.orElseSucceed(() => true));

  const read = Effect.gen(function* () {
    const running = yield* runningAppImage;
    if (Option.isNone(running)) return null;
    const folder = (yield* buildFolder) || path.dirname(running.value);
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
      .sort((left, right) => right.mtime - left.mtime);
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

  return { state, undo: undo(), redo };
});
