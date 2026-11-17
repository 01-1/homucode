// @effect-diagnostics nodeBuiltinImport:off - runs the real installer script against a temporary home.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it.skipIf(HostProcess.Platform.defaultValue() !== "linux")(
  "installs only a MadoHomu launcher and reuses the supplied Homu runtime, then uninstalls without touching shared state",
  async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "madohomu-install-"));
    try {
      const runtime = NodePath.join(root, "HomuCode's runtime");
      const shared = NodePath.join(root, ".t3", "userdata", "settings.json");
      await NodeFSP.mkdir(NodePath.dirname(shared), { recursive: true });
      await NodeFSP.writeFile(shared, "shared settings");
      await NodeFSP.writeFile(runtime, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
      const env = { ...process.env, MADOHOMU_INSTALL_ROOT: root, MADOHOMU_RUNTIME: runtime };
      const installer = NodePath.join(import.meta.dirname, "install-madohomu.mjs");
      NodeChildProcess.execFileSync(process.execPath, [installer], { env });
      const launcher = NodePath.join(root, ".local", "bin", "madohomu");
      expect(NodeChildProcess.execFileSync(launcher, ["example"], { encoding: "utf8" })).toBe(
        "--madohomu\nexample\n",
      );
      const applications = NodePath.join(root, ".local", "share", "applications");
      expect(await NodeFSP.readdir(applications)).toEqual(["madohomu.desktop"]);
      expect(
        await NodeFSP.readFile(NodePath.join(applications, "madohomu.desktop"), "utf8"),
      ).toContain("Name=MadoHomu");
      NodeChildProcess.execFileSync(process.execPath, [installer, "--uninstall"], { env });
      expect(await NodeFSP.readdir(applications)).toEqual([]);
      expect(await NodeFSP.readFile(shared, "utf8")).toBe("shared settings");
      expect(await NodeFSP.readFile(runtime, "utf8")).toContain("printf");
      const preload = NodePath.join(root, "release-fixture.mjs");
      const artifactArch = HostProcess.Architecture.defaultValue() === "x64" ? "x86_64" : "arm64";
      await NodeFSP.writeFile(
        preload,
        `
        import { createHash } from "node:crypto";
        const bytes = Buffer.from('#!/bin/sh\\nprintf "%s\\\\n" "$@"\\n');
        globalThis.fetch = async (url) => new Response(url.endsWith("/releases/latest")
          ? JSON.stringify({ assets: [{ name: "T3-Code-${artifactArch}.AppImage", digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"), browser_download_url: "https://example.test/runtime" }] }) : bytes);
      `,
      );
      NodeChildProcess.execFileSync(process.execPath, ["--import", preload, installer], {
        env: { ...env, MADOHOMU_RUNTIME: "" },
      });
      expect(NodeChildProcess.execFileSync(launcher, [], { encoding: "utf8" })).toBe(
        "--madohomu\n",
      );
      NodeChildProcess.execFileSync(process.execPath, [installer, "--uninstall"], { env });
      expect(await NodeFSP.readFile(shared, "utf8")).toBe("shared settings");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
