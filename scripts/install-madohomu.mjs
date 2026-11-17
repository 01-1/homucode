#!/usr/bin/env node
/* oxlint-disable t3code/no-global-process-runtime -- Standalone installer runs before HomuCode or its Effect dependencies are installed. */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const installRoot = process.env.MADOHOMU_INSTALL_ROOT ?? NodeOS.homedir();
const data = NodePath.join(installRoot, ".local", "share", "madohomu");
const launcher = NodePath.join(installRoot, ".local", "bin", "madohomu");
const desktop = NodePath.join(installRoot, ".local", "share", "applications", "madohomu.desktop");
const quoteShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const quoteExec = (value) =>
  `"${value.replaceAll("\\", "\\\\\\\\").replaceAll('"', '\\\\"').replaceAll("`", "\\\\`").replaceAll("$", "\\\\$").replaceAll("%", "%%")}"`;

if (process.argv.includes("--uninstall")) {
  await NodeFSP.rm(launcher, { force: true });
  await NodeFSP.rm(desktop, { force: true });
  await NodeFSP.rm(data, { recursive: true, force: true });
  console.log("Removed MadoHomu. Shared HomuCode settings and threads are preserved.");
} else {
  if (NodeOS.platform() !== "linux")
    throw new Error(
      "This installer supports Linux. On Windows or macOS, enable MadoHomu's desktop app in HomuCode Settings → MadoHomu.",
    );
  let runtime = process.env.MADOHOMU_RUNTIME;
  if (runtime) {
    runtime = NodePath.resolve(runtime);
    await NodeFSP.access(runtime);
  } else {
    const arch = NodeOS.arch() === "x64" ? "x86_64" : NodeOS.arch() === "arm64" ? "arm64" : null;
    if (!arch) throw new Error(`No HomuCode desktop runtime is available for ${NodeOS.arch()}.`);
    const releaseResponse = await fetch(
      "https://api.github.com/repos/01-1/homucode/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!releaseResponse.ok)
      throw new Error(
        "HomuCode has no downloadable release yet. Build its desktop runtime and rerun with MADOHOMU_RUNTIME=/path/to/HomuCode.AppImage.",
      );
    const release = await releaseResponse.json();
    const asset = release.assets.find((item) => item.name === `T3-Code-${arch}.AppImage`);
    if (!asset?.digest?.startsWith("sha256:"))
      throw new Error("The HomuCode release has no matching AppImage with a SHA-256 digest.");
    const response = await fetch(asset.browser_download_url);
    if (!response.ok) throw new Error("Could not download the HomuCode runtime.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (`sha256:${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}` !== asset.digest)
      throw new Error("HomuCode download checksum mismatch.");
    await NodeFSP.mkdir(data, { recursive: true });
    runtime = NodePath.join(data, "Homu-Code.AppImage");
    const temporary = `${runtime}.${NodeCrypto.randomUUID()}`;
    await NodeFSP.writeFile(temporary, bytes, { mode: 0o700 });
    await NodeFSP.rename(temporary, runtime);
  }
  await NodeFSP.mkdir(NodePath.dirname(launcher), { recursive: true });
  await NodeFSP.mkdir(NodePath.dirname(desktop), { recursive: true });
  await NodeFSP.writeFile(launcher, `#!/bin/sh\nexec ${quoteShell(runtime)} --madohomu "$@"\n`, {
    mode: 0o755,
  });
  await NodeFSP.chmod(launcher, 0o755);
  await NodeFSP.writeFile(
    desktop,
    `[Desktop Entry]\nType=Application\nName=MadoHomu\nExec=${quoteExec(launcher)}\nStartupWMClass=t3code-madohomu\nTerminal=false\nCategories=Development;\n`,
  );
  console.log(
    `Installed MadoHomu: ${launcher}\nOnly the MadoHomu launcher was installed. Its HomuCode runtime shares T3 Code's server and threads.`,
  );
}
