import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

export const LOCAL_CODEX_USAGE_STOP_CODE = "local_category_usage_stop";
export const LOCAL_CODEX_USAGE_STOP_MESSAGE =
  "The local Codex category is paused by its usage limit. Retry after the category becomes available.";

// Advisory correlation only. Never writes/takes the usage guard's lock, changes
// caps/models, cancels a provider request or manufactures category availability.
export function correlateLocalCodexUsageStop(
  failure: OrchestrationV2ProviderFailure,
  raw: string,
  observedAtMs: number,
): OrchestrationV2ProviderFailure | undefined {
  if (failure.code !== "modelNotFound" && failure.code !== "model_not_found") return undefined;
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof state !== "object" ||
    state === null ||
    !("latches" in state) ||
    typeof state.latches !== "object" ||
    state.latches === null ||
    Array.isArray(state.latches)
  )
    return undefined;
  const matching = Object.values(state.latches).some((value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("category" in value) ||
      value.category !== "codex" ||
      !("at" in value) ||
      typeof value.at !== "number" ||
      !Number.isFinite(value.at) ||
      value.at * 1000 > observedAtMs ||
      !("box" in value) ||
      typeof value.box !== "string" ||
      !("reason" in value) ||
      typeof value.reason !== "string"
    )
      return false;
    // A durable latch remains a stop past nominal end until its writer removes it.
    // Do not turn its end time into resetAt/permission for automatic resumption.
    return true;
  });
  return matching
    ? {
        ...failure,
        class: "usage_limit",
        code: LOCAL_CODEX_USAGE_STOP_CODE,
        message: LOCAL_CODEX_USAGE_STOP_MESSAGE,
        retryable: false,
        resetAt: null,
      }
    : undefined;
}

export function readLocalCodexUsageStop(
  fileSystem: Pick<FileSystem.FileSystem, "readFileString">,
  guardPath: string | undefined,
  failure: OrchestrationV2ProviderFailure,
  observedAtMs: number,
): Effect.Effect<OrchestrationV2ProviderFailure> {
  if (
    guardPath === undefined ||
    (failure.code !== "modelNotFound" && failure.code !== "model_not_found")
  )
    return Effect.succeed(failure);
  return fileSystem.readFileString(guardPath).pipe(
    Effect.map((raw) => correlateLocalCodexUsageStop(failure, raw, observedAtMs) ?? failure),
    // Missing/unreadable/transient state is unknown, never evidence of a usage stop
    // or permission to start. Preserve the original native failure exactly.
    Effect.orElseSucceed(() => failure),
  );
}
