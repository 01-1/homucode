import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as StatusLine from "./StatusLine.ts";

const windowsHost = HostProcess.Platform.defaultValue() === "win32";

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
        Layer.provide(ServerSettings.layerTest(settings)),
        Layer.provide(ProcessRunner.layer),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

it.live.skipIf(windowsHost)("runs the command in the workspace with the input on stdin", () =>
  Effect.gen(function* () {
    const dir = NodeOS.tmpdir();
    const result = yield* render(
      { statusLineCommand: `printf '%s ' "$(pwd -P)"; cat` },
      { workspace: { current_dir: dir }, model: { display_name: "Opus 5.5" } },
    );
    assert.deepStrictEqual(result, {
      text: `${NodeFS.realpathSync(dir)} {"workspace":{"current_dir":"${dir}"},"model":{"display_name":"Opus 5.5"}}`,
    });
  }),
);

it.live.skipIf(windowsHost)("falls back to home for a missing workspace", () =>
  Effect.gen(function* () {
    const result = yield* render(
      { statusLineCommand: "pwd -P" },
      { workspace: { current_dir: "/does/not/exist" } },
    );
    assert.strictEqual(result.text, NodeFS.realpathSync(NodeOS.homedir()));
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
