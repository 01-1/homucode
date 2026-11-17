import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { BuildToolsRequest } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { BuildToolsRequest as RequestSchema } from "@t3tools/contracts";
import * as Config from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import { makeReplayServerConfig } from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as BuildTools from "./BuildTools.ts";

const decodeRequest = Schema.decodeSync(RequestSchema);
const request = (action: BuildToolsRequest["action"]) => decodeRequest({ action, ref: "HEAD" });
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* makeReplayServerConfig("build-tools");
  const repo = config.baseDir;
  const boat = path.join(repo, "fake-boat");
  const runner = yield* ProcessRunner.ProcessRunner;
  const git = (...args: string[]) => runner.run({ command: "git", args, cwd: repo });
  yield* git("init", "--quiet");
  yield* git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const sha = (yield* git("rev-parse", "HEAD")).stdout.trim();
  yield* fs.writeFileString(boat, "#!/bin/sh\necho 'fixture boat signed in'\n");
  yield* fs.chmod(boat, 0o700);
  yield* fs.makeDirectory(path.join(repo, "addons/cloud-build"), { recursive: true });
  yield* fs.makeDirectory(path.join(repo, "scripts/homu-android"), { recursive: true });
  yield* fs.makeDirectory(path.join(repo, "addons/load-build"), { recursive: true });
  yield* fs.writeFileString(
    path.join(repo, "addons/cloud-build/boat_t3_build.py"),
    `import pathlib, sys
args = sys.argv
output = pathlib.Path(args[args.index('--output') + 1])
(output / 'artifacts').mkdir(parents=True)
(output / 'artifacts/T3-Code-fixture.AppImage').write_text('fixture')
print('fixture cloud build completed')
`,
  );
  yield* fs.writeFileString(
    path.join(repo, "scripts/homu-android/build.sh"),
    '#!/bin/bash\nset -eu\nmkdir -p "$OUT"\nprintf fixture > "$OUT/HomuCode-development-${1:0:10}.apk"\necho fixture Android completed\n',
  );
  yield* fs.writeFileString(
    path.join(repo, "addons/load-build/t3-load-build"),
    "print('fixture loader: no restart')\n",
  );
  const settings = ServerSettings.layerTest({
    buildRepoPath: repo,
    buildBoatCliPath: boat,
    buildOutputFolder: path.join(repo, "outputs"),
  });
  const context = yield* Layer.build(
    BuildTools.layer.pipe(
      Layer.provideMerge(settings),
      Layer.provide(Layer.succeed(Config.ServerConfig, config)),
      Layer.provide(Layer.succeed(HostProcess.HomeDirectory, repo)),
      Layer.provide(
        Layer.succeed(
          BuildTools.RunningAppImage,
          Effect.succeed(path.join(repo, "T3-Code-running.AppImage")),
        ),
      ),
    ),
  );
  const service = Context.get(context, BuildTools.BuildTools);
  const saved = Context.get(context, ServerSettings.ServerSettingsService);
  const finish = service.changes.pipe(
    Stream.filter((state) => state.phase === "completed" || state.phase === "failed"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
  return { service, saved, finish, fs, path, repo, boat, sha };
});

const fixtureLayer = ProcessRunner.layerWithSpawner.pipe(Layer.provideMerge(NodeServices.layer));
it.live("keeps tools disabled, then reports fake cloud and APK artifacts and a fake loader", () =>
  Effect.gen(function* () {
    const { service, saved, finish, fs, path, repo, sha } = yield* fixture;
    yield* service.run(request("cloud-build"));
    expect((yield* finish).message).toBe("Enable this build tool in Settings first.");
    const folder = path.join(repo, "custom-appimages");
    yield* fs.makeDirectory(folder);
    for (const [name, seconds] of [
      ["T3-Code-older.AppImage", 1_000],
      ["T3-Code-staged.AppImage", 2_000],
    ] as const) {
      yield* fs.writeFileString(path.join(folder, name), name);
      yield* fs.utimes(path.join(folder, name), seconds, seconds);
    }
    yield* saved.updateSettings({
      cloudBuildEnabled: true,
      androidBuildEnabled: true,
      loadBuildEnabled: true,
      buildAppImageFolder: folder,
    });
    const undone = yield* service.run(request("undo"));
    expect(undone.stagedBuilds).toMatchObject({
      folder,
      running: "T3-Code-running.AppImage",
      next: "T3-Code-older.AppImage",
    });
    expect(yield* fs.exists(path.join(folder, "T3-Code-staged.AppImage.off"))).toBe(true);
    const restored = yield* service.run({ ...request("redo"), undoneAs: undone.undoneAs! });
    expect(restored.stagedBuilds?.next).toBe("T3-Code-staged.AppImage");
    yield* service.run(request("cloud-build"));
    const cloud = yield* finish;
    expect(cloud.phase).toBe("completed");
    expect(cloud.output).toContain("fixture cloud build completed");
    expect(yield* fs.readFileString(cloud.artifactPath!)).toBe("fixture");
    yield* service.run(request("android"));
    const android = yield* finish;
    expect(android.phase).toBe("completed");
    expect(android.artifactPath).toBe(
      path.join(repo, `app/mobile/HomuCode-development-${sha.slice(0, 10)}.apk`),
    );
    expect(yield* fs.readFileString(android.artifactPath!)).toBe("fixture");
    yield* service.run({
      ...request("load"),
      stagedFile: path.join(repo, "T3-Code-fixture.AppImage.staged"),
      sha256: "a".repeat(64),
    });
    const load = yield* finish;
    expect(load.phase).toBe("completed");
    expect(load.output).toContain("fixture loader: no restart");
  }).pipe(Effect.scoped, Effect.provide(fixtureLayer)),
);

it.live("reports missing boat sign-in and missing artifacts instead of claiming success", () =>
  Effect.gen(function* () {
    const { service, saved, finish, fs, boat, path, repo } = yield* fixture;
    yield* saved.updateSettings({ cloudBuildEnabled: true });
    yield* fs.writeFileString(boat, "#!/bin/sh\necho 'Sign in with boat login' >&2\nexit 1\n");
    yield* service.run(request("cloud-build"));
    const unavailable = yield* finish;
    expect(unavailable.phase).toBe("failed");
    expect(unavailable.message).toContain("boat login");
    expect(unavailable.output).toContain("Sign in with boat login");
    yield* fs.writeFileString(boat, "#!/bin/sh\nexit 0\n");
    yield* fs.writeFileString(
      path.join(repo, "addons/cloud-build/boat_t3_build.py"),
      "print('no artifact')\n",
    );
    yield* service.run(request("cloud-build"));
    const absent = yield* finish;
    expect(absent.phase).toBe("failed");
    expect(absent.artifactPath).toBeNull();
    expect(absent.message).toContain("expected artifact");
    expect((yield* service.run(request("stop-serving"))).lanUrl).toBeNull();
  }).pipe(Effect.scoped, Effect.provide(fixtureLayer)),
);
