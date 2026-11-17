import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  APP_SCRIPT_TYPE_DEFINITIONS,
  type AppScriptLoadError,
  MAX_APP_SCRIPT_SOURCE_BYTES,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as AppScripts from "./appScripts.ts";
import * as ServerConfig from "./config.ts";

const layer = AppScripts.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-app-scripts-" })),
  Layer.provideMerge(NodeServices.layer),
);

const writeScript = (name: string, source: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const directory = path.join(stateDir, "scripts");
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(path.join(directory, `${name}.ts`), source);
    return directory;
  });

const loadError = (name: string) =>
  Effect.gen(function* () {
    const scripts = yield* AppScripts.AppScripts;
    return yield* Effect.flip(scripts.load({ name }));
  });

it.layer(layer)("AppScripts", (it) => {
  it.effect("strips types, keeps the code, and writes the editor types beside it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* writeScript(
        "greet",
        "export default async (t3: T3App): Promise<void> => { t3.toast(`hi` as string); };",
      );
      const scripts = yield* AppScripts.AppScripts;
      const loaded = yield* scripts.load({ name: "greet" });
      assert.notInclude(loaded.code, "T3App");
      assert.include(loaded.code, "t3.toast(`hi`");
      assert.strictEqual(loaded.path, path.join(directory, "greet.ts"));
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(directory, "t3.d.ts")),
        APP_SCRIPT_TYPE_DEFINITIONS,
      );
    }),
  );

  it.effect("reports missing, oversized, and non-erasable scripts", () =>
    Effect.gen(function* () {
      yield* writeScript("huge", `// ${"x".repeat(MAX_APP_SCRIPT_SOURCE_BYTES)}`);
      yield* writeScript("enum", "enum Mode { A } export default async () => Mode.A;");
      const reasons: Array<AppScriptLoadError["reason"]> = [];
      for (const name of ["missing", "huge", "enum"]) reasons.push((yield* loadError(name)).reason);
      assert.deepStrictEqual(reasons, ["not-found", "too-large", "invalid-typescript"]);
    }),
  );
});
