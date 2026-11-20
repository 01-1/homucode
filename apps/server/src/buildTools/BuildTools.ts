// @effect-diagnostics nodeBuiltinImport:off -- owns the optional LAN APK server.
import { makeStagedBuilds } from "@t3tools/shared/stagedBuilds";
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import { BuildToolsError, type BuildToolsRequest, type BuildToolsState } from "@t3tools/contracts";
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProcessRunner from "../processRunner.ts";
import { BackgroundGitEnabled } from "../vcs/BackgroundGit.ts";

export class BuildTools extends Context.Service<
  BuildTools,
  {
    readonly changes: Stream.Stream<BuildToolsState>;
    readonly run: (input: BuildToolsRequest) => Effect.Effect<BuildToolsState, BuildToolsError>;
  }
>()("t3/buildTools/BuildTools") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const config = yield* Config.ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const scope = yield* Scope.Scope;
  const lock = yield* Semaphore.make(1);
  const backgroundGitEnabled = yield* BackgroundGitEnabled;
  const backgroundGitOverridden = Option.isSome(
    yield* EffectConfig.option(EffectConfig.String("T3CODE_BACKGROUND_GIT")).pipe(Effect.orDie),
  );
  let lan: NodeHttp.Server | undefined;
  const appImage = config.mode === "desktop" ? (config.desktopAppImagePath ?? "") : "";
  const appImageAvailable = appImage.includes(".AppImage");
  const initialSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
  const expand = (value: string) =>
    value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
  const defaultFolder = appImageAvailable ? path.dirname(appImage) : path.join(home, "app");
  const staged = yield* makeStagedBuilds(
    Effect.succeed(appImageAvailable ? Option.some(appImage) : Option.none()),
    settingsService.getSettings.pipe(
      Effect.map((settings) => expand(settings.buildAppImageFolder) || undefined),
      Effect.orDie,
    ),
  );
  const initialStaged = yield* staged.state.pipe(Effect.orElseSucceed(() => null));
  const state = yield* SubscriptionRef.make<BuildToolsState>({
    stagedBuilds: initialStaged,
    undoneAs: null,
    phase: "idle",
    message: "Enable a build tool and configure a HomuCode checkout to begin.",
    output: "",
    artifactPath: null,
    lanUrl: null,
    appImageAvailable,
    buildFolder: expand(initialSettings.buildAppImageFolder) || defaultFolder,
    backgroundGitEnabled,
    backgroundGitOverridden,
  });
  const closeLan = () =>
    new Promise<void>((resolve) => {
      const current = lan;
      lan = undefined;
      if (!current) return resolve();
      current.close(() => resolve());
      current.closeAllConnections();
    });
  yield* Effect.addFinalizer(() => Effect.promise(closeLan));
  const set = (patch: Partial<BuildToolsState>) =>
    SubscriptionRef.update(state, (current) => ({ ...current, ...patch }));
  const runProcess = Effect.fn("BuildTools.runProcess")(function* (
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
    env?: NodeJS.ProcessEnv,
  ) {
    return yield* runner
      .run({
        command,
        args,
        cwd,
        env,
        timeout: "3 hours",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(Effect.mapError((cause) => new BuildToolsError({ reason: "unavailable", cause })));
  });
  const execute = Effect.fn("BuildTools.execute")(function* (input: BuildToolsRequest) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })),
    );
    const repo = expand(settings.buildRepoPath) || config.cwd;
    const boat = expand(settings.buildBoatCliPath) || "boat";
    const buildFolder = expand(settings.buildAppImageFolder) || defaultFolder;
    yield* set({ buildFolder });
    if (input.action === "load") {
      if (!settings.loadBuildEnabled) return yield* new BuildToolsError({ reason: "disabled" });
      if (!appImageAvailable) return yield* new BuildToolsError({ reason: "unavailable" });
      if (
        !/^T3-Code-.+\.AppImage\.staged$/.test(path.basename(input.stagedFile)) ||
        !/^[a-f\d]{64}$/i.test(input.sha256)
      )
        return yield* new BuildToolsError({ reason: "invalid-input" });
      yield* fs
        .makeDirectory(buildFolder, { recursive: true })
        .pipe(Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })));
      const wakeFile = path.join(config.stateDir, "build-loader-wake.txt");
      yield* fs
        .writeFileString(wakeFile, "T3 Code loaded a staged build.")
        .pipe(Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })));
      const result = yield* runProcess(
        "python3",
        [
          path.join(repo, "addons/load-build/t3-load-build"),
          expand(input.stagedFile),
          input.sha256,
          wakeFile,
          "--detach",
          "--live",
          path.join(
            buildFolder,
            path
              .basename(input.stagedFile)
              .replace(/-next\.AppImage\.staged$/, "-x86_64.AppImage")
              .replace(/\.staged$/, ""),
          ),
        ],
        repo,
        {
          ...process.env,
          T3_BUILD_FOLDER: buildFolder,
          T3_BUILD_PREVIOUS: appImage,
        },
      );
      if (result.code !== 0)
        return yield* new BuildToolsError({ reason: "process", cause: result });
      yield* set({
        phase: "completed",
        message:
          "Build loader started. It verifies the checksum and rolls back if Homu does not return. See ~/.local/state/t3-load-build/load.log.",
        output: result.stdout + result.stderr,
      });
      return;
    }
    if (!(input.action === "android" ? settings.androidBuildEnabled : settings.cloudBuildEnabled))
      return yield* new BuildToolsError({ reason: "disabled" });
    if (!input.ref.trim() || (input.action === "cloud-test" && input.testFiles.length === 0))
      return yield* new BuildToolsError({ reason: "invalid-input" });
    const probe = yield* runProcess(boat, ["--no-update", "--json", "limits", "--all"], repo);
    if (probe.code !== 0) {
      yield* set({ output: (probe.stdout + probe.stderr).slice(-32768) });
      return yield* new BuildToolsError({ reason: "unavailable" });
    }
    const resolved = yield* runProcess(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${input.ref}^{commit}`],
      repo,
    );
    const sha = resolved.stdout.trim();
    if (resolved.code !== 0 || !/^[a-f\d]{40,64}$/.test(sha))
      return yield* new BuildToolsError({ reason: "invalid-input" });
    const outputRoot = expand(settings.buildOutputFolder) || path.join(home, "hold/t3-builds");
    yield* fs
      .makeDirectory(outputRoot, { recursive: true })
      .pipe(Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })));
    const output = yield* fs
      .makeTempDirectory({ directory: outputRoot, prefix: `${sha.slice(0, 10)}-` })
      .pipe(Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })));
    const result =
      input.action === "android"
        ? yield* runProcess("bash", [path.join(repo, "scripts/homu-android/build.sh"), sha], repo, {
            ...process.env,
            T3_BUILD_BOAT_CLI: boat,
            MODE: "apk",
            PUBLISH_OTA: "0",
            VARIANT: "development",
            APP_NAME: "HomuCode",
            OUT: path.join(home, "app/mobile"),
          })
        : yield* runProcess(
            "python3",
            [
              path.join(repo, "addons/cloud-build/boat_t3_build.py"),
              "--repo",
              repo,
              "--revision",
              sha,
              "--output",
              path.join(output, "result"),
              "--machine-type",
              settings.buildMachineType,
              ...(input.action === "cloud-test"
                ? ["--mode", "test", ...input.testFiles.flatMap((file) => ["--test-file", file])]
                : []),
            ],
            repo,
            { ...process.env, T3_BUILD_BOAT_CLI: boat },
          );
    const resultFolder = path.join(output, "result");
    const artifact =
      input.action === "android"
        ? path.join(home, `app/mobile/HomuCode-development-${sha.slice(0, 10)}.apk`)
        : input.action === "cloud-test"
          ? resultFolder
          : yield* fs.readDirectory(path.join(resultFolder, "artifacts")).pipe(
              Effect.map((names) => {
                const name = names.find((name) => /^T3-Code-.+\.AppImage$/.test(name));
                return name ? path.join(resultFolder, "artifacts", name) : "";
              }),
              Effect.orElseSucceed(() => ""),
            );
    const succeeded = result.code === 0 && artifact !== "" && (yield* fs.exists(artifact));
    yield* set({
      phase: succeeded ? "completed" : "failed",
      message: succeeded
        ? "Build finished."
        : result.code === 0
          ? "Build exited without the expected artifact. Check the saved logs."
          : "Build failed. Check the output and saved logs.",
      output: (result.stdout + result.stderr).slice(-32768),
      artifactPath: succeeded ? artifact : null,
    });
  });

  const run = Effect.fn("BuildTools.run")(function* (input: BuildToolsRequest) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (input.action === "stop-serving") {
          yield* Effect.promise(closeLan);
          yield* set({ lanUrl: null });
          return yield* SubscriptionRef.get(state);
        }
        if (input.action === "undo" || input.action === "redo") {
          const result =
            input.action === "undo"
              ? yield* staged.undo.pipe(
                  Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })),
                )
              : {
                  state: yield* staged
                    .redo(input.undoneAs)
                    .pipe(
                      Effect.mapError((cause) => new BuildToolsError({ reason: "storage", cause })),
                    ),
                  undoneAs: null,
                };
          yield* set({ stagedBuilds: result.state, undoneAs: result.undoneAs });
          return yield* SubscriptionRef.get(state);
        }
        if (input.action === "serve") {
          if (!(yield* settingsService.getSettings.pipe(Effect.orDie)).androidBuildEnabled)
            return yield* new BuildToolsError({ reason: "disabled" });
          if (!lan) {
            const directory = path.join(home, "app/mobile");
            const address = Object.values(NodeOS.networkInterfaces())
              .flat()
              .find(
                (entry) =>
                  entry &&
                  entry.family === "IPv4" &&
                  !entry.internal &&
                  !entry.address.startsWith("100."),
              )?.address;
            if (!address) return yield* new BuildToolsError({ reason: "unavailable" });
            const server = NodeHttp.createServer((request, response) => {
              let name: string;
              try {
                name = decodeURIComponent((request.url ?? "").split("?")[0] ?? "").slice(1);
              } catch {
                response.writeHead(400).end();
                return;
              }
              if (!/^HomuCode-development-[a-f\d]+\.apk$/.test(name)) {
                response.writeHead(404).end();
                return;
              }
              const file = NodeFS.createReadStream(path.join(directory, name));
              file.on("error", () => {
                if (!response.headersSent) response.writeHead(404);
                response.end();
              });
              response.setHeader("Content-Type", "application/vnd.android.package-archive");
              file.pipe(response);
            });
            yield* Effect.tryPromise({
              try: () =>
                new Promise<void>((resolve, reject) => {
                  server.once("error", reject);
                  server.listen(8767, address, resolve);
                }),
              catch: (cause) => new BuildToolsError({ reason: "unavailable", cause }),
            });
            lan = server;
            yield* set({ lanUrl: `http://${address}:8767/` });
          }
          return yield* SubscriptionRef.get(state);
        }
        if ((yield* SubscriptionRef.get(state)).phase === "running")
          return yield* new BuildToolsError({ reason: "busy" });
        yield* set({
          phase: "running",
          message: "Running build tool…",
          output: "",
          artifactPath: null,
        });
        yield* execute(input).pipe(
          Effect.catch((error) => set({ phase: "failed", message: error.message })),
          Effect.forkIn(scope),
        );
        return yield* SubscriptionRef.get(state);
      }),
    );
  });
  const refresh = Effect.gen(function* () {
    const saved = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* set({
      buildFolder: expand(saved.buildAppImageFolder) || defaultFolder,
      stagedBuilds: yield* staged.state.pipe(Effect.orElseSucceed(() => null)),
    });
  });
  yield* (yield* settingsService.subscribeChanges).pipe(
    Stream.runForEach(() => refresh),
    Effect.forkIn(scope),
  );
  return BuildTools.of({
    run,
    changes: Stream.unwrap(refresh.pipe(Effect.as(SubscriptionRef.changes(state)))),
  });
});

export const layer = Layer.effect(BuildTools, make);
