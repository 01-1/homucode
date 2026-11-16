import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopStagedBuilds from "./DesktopStagedBuilds.ts";

const RUNNING = "T3-Code-0.1.7-running-x86_64.AppImage";
const OLDER = "T3-Code-0.1.7-older-x86_64.AppImage";
const STAGED = "T3-Code-0.1.7-staged-x86_64.AppImage";

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped();
  const files: ReadonlyArray<readonly [string, number]> = [
    [OLDER, 1_000],
    [RUNNING, 2_000],
    [STAGED, 3_000],
    // Not launchable: kept or undone builds.
    ["T3-Code-0.1.7-kept-x86_64.AppImage.staged", 9_000],
    [`${STAGED}.off`, 8_000],
  ];
  for (const [name, seconds] of files) {
    yield* fs.writeFileString(path.join(folder, name), name);
    yield* fs.utimes(path.join(folder, name), seconds, seconds);
  }
  const service = yield* DesktopStagedBuilds.make.pipe(
    Effect.provideService(
      DesktopEnvironment.DesktopEnvironment,
      DesktopEnvironment.DesktopEnvironment.of({
        path,
        platform: "linux",
        appImagePath: Option.some(path.join(folder, RUNNING)),
      } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
  );
  return { service, folder, fs, path };
});

it.layer(NodeServices.layer)("DesktopStagedBuilds", (it) => {
  it.effect("undo makes the build staged before the newest load next, and redo restores it", () =>
    Effect.gen(function* () {
      const { service, folder, fs, path } = yield* setup;

      expect(yield* service.state).toEqual({
        folder,
        running: RUNNING,
        next: STAGED,
        previous: RUNNING,
      });

      const undone = yield* service.undo;
      // An earlier undo of the same name is kept.
      expect(undone.undoneAs).toBe(`${STAGED}.off-1`);
      expect(undone.state).toEqual({ folder, running: RUNNING, next: RUNNING, previous: OLDER });
      expect(yield* fs.readFileString(path.join(folder, `${STAGED}.off`))).toBe(`${STAGED}.off`);

      expect(yield* service.redo(undone.undoneAs)).toEqual({
        folder,
        running: RUNNING,
        next: STAGED,
        previous: RUNNING,
      });
      expect(yield* fs.readFileString(path.join(folder, STAGED))).toBe(STAGED);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps one build to start, and redoes only undone builds in its folder", () =>
    Effect.gen(function* () {
      const { service } = yield* setup;
      yield* service.undo;
      yield* service.undo;

      const last = yield* service.undo.pipe(Effect.flip);
      expect(last.message).toBe("There is no earlier build to go back to.");
      expect((yield* service.state)?.next).toBe(OLDER);

      for (const name of [`../${STAGED}.off`, STAGED, `${STAGED}.staged`]) {
        expect((yield* service.redo(name).pipe(Effect.flip)).message).toBe(
          `${name} is not an undone build.`,
        );
      }
      yield* service.redo(`${STAGED}.off-1`);
      const taken = yield* service.redo(`${STAGED}.off`).pipe(Effect.flip);
      expect(taken.message).toBe(`${STAGED} already exists.`);
    }).pipe(Effect.scoped),
  );
});
