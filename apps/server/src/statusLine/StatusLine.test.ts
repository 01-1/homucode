import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as StatusLine from "./StatusLine.ts";

const windowsHost = HostProcess.Platform.defaultValue() === "win32";

// A real directory, resolved the way `pwd -P` prints it.
const tempDirectory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
}).pipe(Effect.provide(NodeServices.layer));

const render = (
  settings: { statusLineEnabled?: boolean; statusLineCommand?: string },
  input: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const statusLine = yield* StatusLine.StatusLine;
    return yield* statusLine.render({ input });
  }).pipe(
    Effect.provide(
      StatusLine.layer.pipe(
        Layer.provide(ServerSettings.layerTest({ statusLineEnabled: true, ...settings })),
        Layer.provide(ProcessRunner.layer),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

it.live.skipIf(windowsHost)("runs the command in the workspace with the input on stdin", () =>
  Effect.gen(function* () {
    const dir = yield* tempDirectory;
    const result = yield* render(
      { statusLineCommand: `printf '%s ' "$(pwd -P)"; cat` },
      { workspace: { current_dir: dir }, model: { display_name: "Opus 5.5" } },
    );
    assert.deepStrictEqual(result, {
      text: `${dir} {"workspace":{"current_dir":"${dir}"},"model":{"display_name":"Opus 5.5"}}`,
    });
  }),
);

it.live.skipIf(windowsHost)("falls back to home for a missing workspace", () =>
  Effect.gen(function* () {
    const home = yield* tempDirectory;
    const result = yield* render(
      { statusLineCommand: "pwd -P" },
      { workspace: { current_dir: `${home}/missing` } },
    ).pipe(Effect.provideService(HostProcess.HomeDirectory, home));
    assert.strictEqual(result.text, home);
  }),
);

it.live.skipIf(windowsHost)("reports a failing command", () =>
  Effect.gen(function* () {
    const result = yield* render(
      { statusLineCommand: "printf partial; echo broken >&2; exit 3" },
      {},
    );
    assert.deepStrictEqual(result, { text: "partial", error: "broken" });
  }),
);

it.live("renders nothing while disabled", () =>
  Effect.gen(function* () {
    const result = yield* render(
      { statusLineEnabled: false, statusLineCommand: "echo should-not-run" },
      {},
    );
    assert.deepStrictEqual(result, { text: "" });
  }),
);
