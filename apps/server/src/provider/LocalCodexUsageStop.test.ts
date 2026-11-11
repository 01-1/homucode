import {assert, it} from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type {OrchestrationV2ProviderFailure} from "@t3tools/contracts";
import {correlateLocalCodexUsageStop, readLocalCodexUsageStop} from "./LocalCodexUsageStop.ts";

const failure: OrchestrationV2ProviderFailure = {class: "provider_error", code: "modelNotFound",
  message: "unknown provider for model gpt-6.1-terra", retryable: true};

it("does not use a future latch as evidence at this error observation", () => {
  const raw = JSON.stringify({latches: {future: {category: "codex", box: "Preparation", reason: "allowance reached", at: 101}}});
  assert.isUndefined(correlateLocalCodexUsageStop(failure, raw, 100_000));
});

it("preserves a non-model error even with a current matching latch", () => {
  const raw = JSON.stringify({latches: {current: {category: "codex", box: "Preparation", reason: "allowance reached", at: 99}}});
  assert.isUndefined(correlateLocalCodexUsageStop({...failure, code: "httpConnectionFailed"}, raw, 100_000));
});

it.effect("missing guard is unknown and leaves original error unchanged without creating a file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({prefix: "codex-missing-guard-"});
    const path = `${root}/hard-stops.json`;
    assert.strictEqual(yield* readLocalCodexUsageStop(fs, path, failure, 100_000), failure);
    assert.isFalse(yield* fs.exists(path));
    assert.strictEqual(yield* readLocalCodexUsageStop(fs, undefined, failure, 100_000), failure);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
