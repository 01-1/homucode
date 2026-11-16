// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** False where chmod cannot deny access: root, CAP_DAC_OVERRIDE sandboxes such as CI runners, Windows. */
export const chmodDeniesAccess: boolean = (() => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-chmod-probe-"));
  const file = NodePath.join(dir, "probe");
  try {
    NodeFS.writeFileSync(file, "");
    NodeFS.chmodSync(file, 0);
    NodeFS.readFileSync(file);
    return false;
  } catch {
    return true;
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
})();
