// @effect-diagnostics nodeBuiltinImport:off - streams TypeScript's resolution trace.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";
import { readWorkspace } from "../.github/scripts/ci-changes.cjs";

const root = NodePath.join(import.meta.dirname, "..");
const compilerManifest = new URL(import.meta.resolve("@effect/tsgo/package.json"));
const { bin } = JSON.parse(NodeFS.readFileSync(compilerManifest, "utf8"));
const compilerPath = NodeURL.fileURLToPath(new URL(bin["effect-tsgo"], compilerManifest));
const projects = readWorkspace()
  .map(({ dir }) => dir)
  .filter((project) => NodeFS.existsSync(NodePath.join(root, project, "tsconfig.json")));
const baseline = new Set(
  NodeFS.readFileSync(new URL("./module-resolution-baseline.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#")),
);

using temp = NodeFS.mkdtempDisposableSync(NodePath.join(NodeOS.tmpdir(), "t3-module-resolution-"));
const trace = NodePath.join(temp.path, "trace.txt");
const missing = new Map<string, string>();
for (const project of projects) {
  // Piped tsgo output can interleave the trace records even with --singleThreaded.
  const output = NodeFS.openSync(trace, "w");
  const compiler = (() => {
    try {
      return NodeChildProcess.spawnSync(
        process.execPath,
        [
          compilerPath,
          "tsrs",
          "--listFilesOnly",
          "--traceResolution",
          "--singleThreaded",
          "--pretty",
          "false",
        ],
        {
          cwd: NodePath.join(root, project),
          stdio: ["ignore", output, "inherit"],
        },
      );
    } finally {
      NodeFS.closeSync(output);
    }
  })();
  if (compiler.error) throw compiler.error;
  let current: RegExpExecArray | null = null;
  let resolutions = 0;
  let compilerErrors = "";
  for await (const line of NodeReadline.createInterface({
    input: NodeFS.createReadStream(trace),
    crlfDelay: Infinity,
  })) {
    const start = /^======== Resolving module '(.+)' from '(.+)'\./.exec(line);
    if (start) {
      current = start;
      continue;
    }
    const end = /^======== Module name '(.+)' was (not|successfully) resolved\b/.exec(line);
    if (!end) {
      if (/error TS\d+:/.test(line)) compilerErrors += `${line}\n`;
      continue;
    }
    if (!current || end[1] !== current[1]) {
      throw new Error(
        `Unexpected TypeScript resolution trace in ${project}: ${line} after ${current?.[0]}`,
      );
    }
    resolutions++;
    const [, specifier, importer] = current;
    current = null;
    if (end[2] !== "not" || !specifier || !importer || NodeModule.isBuiltin(specifier)) continue;
    const packageName = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(importer)?.[1];
    if (!packageName) continue;
    const entry = `${packageName} -> ${specifier}`;
    missing.set(entry, `${project}: ${importer}`);
  }
  if (compiler.status !== 0 || resolutions === 0 || current) {
    throw new Error(
      `Incomplete TypeScript resolution trace in ${project} (exit ${compiler.status}).\n${compilerErrors}`,
    );
  }
}

const unexpected = [...missing.keys()].filter((entry) => !baseline.has(entry)).sort();
if (unexpected.length > 0) {
  process.stderr.write("Unresolved imports in dependency types:\n");
  for (const entry of unexpected) process.stderr.write(`  ${entry}\n    ${missing.get(entry)}\n`);
  process.stderr.write(
    "Declare the missing dependency or record a reviewed exception in module-resolution-baseline.txt.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked dependency module resolution in ${projects.length} TypeScript projects.\n`,
  );
}
