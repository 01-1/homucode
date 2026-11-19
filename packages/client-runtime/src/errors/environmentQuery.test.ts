import * as Cause from "effect/Cause";
import { expect, it } from "vite-plus/test";

import { formatEnvironmentQueryError } from "./environmentQuery.ts";

it("preserves errors sent by the environment as plain objects", () => {
  const message = "Unknown request: server.buildToolsState";
  expect(formatEnvironmentQueryError(Cause.die({ name: "Error", message }))).toBe(message);
  expect(formatEnvironmentQueryError(Cause.fail(new Error(message)))).toBe(message);
  expect(formatEnvironmentQueryError(Cause.fail({ message: " " }))).toBe(
    "The environment request failed.",
  );
});
