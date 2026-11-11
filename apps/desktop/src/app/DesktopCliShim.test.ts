// @effect-diagnostics nodeBuiltinImport:off - Runs the rendered launcher in a real shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { type CliShimTarget, renderCliShim } from "./DesktopCliShim.ts";

const directories: Array<string> = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

const tempRoot = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-cli-shim-"));
  directories.push(root);
  return root;
};

const writeExecutable = (path: string, content: string) => {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, content, { mode: 0o755 });
};

const writeShim = (root: string, target: CliShimTarget) => {
  const shim = NodePath.join(root, "bin", "t3");
  writeExecutable(shim, renderCliShim({ target, shimPath: shim, t3Home: `${root}/home` }));
  return shim;
};

const run = (shim: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}) =>
  NodeChildProcess.spawnSync(shim, args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });

const REPORTER =
  '#!/bin/sh\necho "node=$ELECTRON_RUN_AS_NODE cli=$T3CODE_CLI_PATH home=$T3CODE_HOME"\nprintf "%s\\n" "$@"\nexit 3\n';

const fakeAppImage = () => {
  const root = tempRoot();
  const image = NodePath.join(root, "image");
  writeExecutable(NodePath.join(image, "t3code"), REPORTER);
  NodeFS.mkdirSync(NodePath.join(image, "resources"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(image, "resources", "app.asar"), "fixture");
  const appImage = NodePath.join(root, "T3 Code.AppImage");
  writeExecutable(
    appImage,
    [
      "#!/bin/sh",
      '[ "$1" = --appimage-extract ] || exit 9',
      `echo extract >> '${root}/extractions'`,
      '[ "$FAIL_EXTRACT" = 1 ] && exit 1',
      `cp -R '${image}' squashfs-root`,
      "",
    ].join("\n"),
  );
  const shim = writeShim(root, { kind: "appimage", appImage, executableName: "t3code" });
  return { root, image, appImage, shim };
};

describe("renderCliShim", () => {
  it("extracts once per image hash and preserves arguments and exit status", () => {
    const { root, appImage, shim } = fakeAppImage();
    const first = run(shim, ["thread", "space and 'quote'"], { APPIMAGE_EXTRACT_AND_RUN: "1" });
    const second = run(shim, ["thread", "space and 'quote'"]);
    expect(first.status).toBe(3);
    expect(second.status).toBe(3);
    expect(second.stdout).toBe(first.stdout);
    expect(first.stdout).toContain("space and 'quote'");
    expect(first.stdout).toContain("/cli-runtime/");
    expect(NodeFS.readFileSync(NodePath.join(root, "extractions"), "utf8")).toBe("extract\n");
    NodeFS.appendFileSync(appImage, "# changed image\n");
    const changed = run(shim, ["--version"]);
    expect(changed.status).toBe(3);
    expect(changed.stdout.split("\n")[1]).not.toBe(first.stdout.split("\n")[1]);
    expect(NodeFS.readFileSync(NodePath.join(root, "extractions"), "utf8")).toBe(
      "extract\nextract\n",
    );
  });

  it("keeps runtime caches per invoking user without changing the install home", () => {
    const { root, shim } = fakeAppImage();
    const firstHome = NodePath.join(root, "first-user");
    const secondHome = NodePath.join(root, "second-user");
    const first = run(shim, [], { HOME: firstHome });
    const second = run(shim, [], { HOME: secondHome });
    expect(first.status).toBe(3);
    expect(second.status).toBe(3);
    expect(first.stdout).toContain(`home=${root}/home`);
    expect(second.stdout).toContain(`home=${root}/home`);
    expect(first.stdout).toContain(`${firstHome}/.cache/t3code/cli-runtime/`);
    expect(second.stdout).toContain(`${secondHome}/.cache/t3code/cli-runtime/`);
    const xdg = NodePath.join(root, "xdg-cache");
    expect(run(shim, [], { HOME: firstHome, XDG_CACHE_HOME: xdg }).stdout).toContain(
      `${xdg}/t3code/cli-runtime/`,
    );
  });

  it("retries failed extraction without publishing a partial runtime", () => {
    const { root, shim } = fakeAppImage();
    expect(run(shim, [], { FAIL_EXTRACT: "1" }).status).toBe(1);
    const cache = NodePath.join(root, "home", ".cache", "t3code", "cli-runtime");
    expect(NodeFS.readdirSync(cache).filter((name) => !name.endsWith(".lock"))).toEqual([]);
    expect(run(shim, []).status).toBe(3);
  });

  it("serializes concurrent extraction and forwards stdin", async () => {
    const { root, image, shim } = fakeAppImage();
    writeExecutable(NodePath.join(image, "t3code"), "#!/bin/sh\ncat\n");
    const invoke = () =>
      new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
        const child = NodeChildProcess.spawn(shim, [], { env: { PATH: process.env.PATH } });
        let stdout = "";
        child.stdout.on("data", (data) => {
          stdout += data;
        });
        child.on("error", reject);
        child.on("close", (status) => resolve({ status, stdout }));
        child.stdin.end("private input");
      });
    expect(await Promise.all([invoke(), invoke()])).toEqual([
      { status: 0, stdout: "private input" },
      { status: 0, stdout: "private input" },
    ]);
    expect(NodeFS.readFileSync(NodePath.join(root, "extractions"), "utf8")).toBe("extract\n");
  });

  it("keeps the install's T3 home under sudo, unless one is set", () => {
    const root = tempRoot();
    writeExecutable(NodePath.join(root, "app"), REPORTER);
    const shim = writeShim(root, {
      kind: "direct",
      executable: NodePath.join(root, "app"),
      entry: "/bin.mjs",
    });
    expect(run(shim, []).stdout).toContain(`home=${root}/home`);
    expect(run(shim, [], { T3CODE_HOME: "/elsewhere" }).stdout).toContain("home=/elsewhere");
    const relative = NodeChildProcess.spawnSync("./bin/t3", [], { cwd: root, encoding: "utf8" });
    expect(relative.stdout).toContain(`cli=${shim}`);
  });

  it("runs an installed app's server directly", () => {
    const root = tempRoot();
    const executable = NodePath.join(root, "opt", "T3 Code", "t3code");
    writeExecutable(executable, REPORTER);
    const shim = writeShim(root, {
      kind: "direct",
      executable,
      entry: "/opt/T3's/app.asar/bin.mjs",
    });
    expect(run(shim, ["browser", "setup"]).stdout.split("\n").slice(1)).toEqual([
      "/opt/T3's/app.asar/bin.mjs",
      "browser",
      "setup",
      "",
    ]);
  });

  it("writes a Windows launcher that keeps cmd from reinterpreting paths", () => {
    const executable = "C:\\Apps\\R&whoami&X 100%\\!CHANNEL!\\T3 Code.exe";
    const script = renderCliShim({
      target: { kind: "windows", executable, entry: "C:\\Apps\\server.asar\\bin.mjs" },
      shimPath: "C:\\Users\\José\\.t3\\bin\\t3.cmd",
      t3Home: "C:\\Users\\José\\.t3",
    });
    const lines = script.split("\r\n");
    expect(lines).toContain("setlocal EnableExtensions DisableDelayedExpansion");
    expect(lines).toContain("chcp 65001 >nul");
    expect(lines).toContain(
      'if exist "C:\\Apps\\R&whoami&X 100%%\\!CHANNEL!\\T3 Code.exe" goto run',
    );
    const bare = lines.filter(
      (line) => line.includes("whoami") && !/"[^"]*whoami[^"]*"/.test(line),
    );
    expect(bare).toEqual([]);
    expect(lines).toContain('set "T3CODE_CLI_PATH=C:\\Users\\José\\.t3\\bin\\t3.cmd"');
  });
});
