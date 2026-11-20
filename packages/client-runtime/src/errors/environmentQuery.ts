import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";
import * as Cause from "effect/Cause";

export function formatEnvironmentQueryError(
  cause: Cause.Cause<unknown>,
  resolve: MFunctionType = mFallback,
): string {
  const error = Cause.squash(cause);
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return resolve(msg("The environment request failed."));
}
