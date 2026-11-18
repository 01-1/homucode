import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createFingerprintAsync } from "expo/fingerprint";
import { expect, it } from "vite-plus/test";

it("keeps native fingerprints stable across pnpm store locations", async () => {
  using temp = NodeFS.mkdtempDisposableSync(NodePath.join(NodeOS.tmpdir(), "t3-fingerprint-"));

  function install(checkout: string, store: string) {
    const project = NodePath.join(temp.path, checkout, "apps/mobile");
    const native = NodePath.join(
      temp.path,
      store,
      "v11/links/@/fixture/1.0.0",
      "a".repeat(64),
      "node_modules/fixture/android",
    );
    const file = NodePath.join(native, "Native.kt");
    NodeFS.mkdirSync(project, { recursive: true });
    NodeFS.mkdirSync(native, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(project, "package.json"), '{"name":"fixture"}');
    NodeFS.writeFileSync(file, "class Native");
    return {
      file,
      fingerprint: () =>
        createFingerprintAsync(project, {
          platforms: ["android"],
          silent: true,
          extraSources: [
            {
              type: "dir",
              filePath: NodePath.relative(project, native).split(NodePath.sep).join("/"),
              reasons: ["fixture"],
            },
          ],
        }),
    };
  }

  const original = install("first", "first store");
  const moved = install("nested/second", "nested/second store");
  const originalHash = (await original.fingerprint()).hash;
  expect((await moved.fingerprint()).hash).toBe(originalHash);

  NodeFS.writeFileSync(moved.file, "class ChangedNative");
  expect((await moved.fingerprint()).hash).not.toBe(originalHash);
});
