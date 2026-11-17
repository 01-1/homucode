import type { EnvironmentTheme } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { readEnvironmentThemes } from "../../apps/server/src/environmentTheme.ts";
import { themeReadResult } from "../../apps/server/src/mcp/toolkits/theme/handlers.ts";

/** T3's `t3_theme_read` answer for a world's theme setting and published themes. */
export const themeRead = (
  world: { readonly defaultTheme?: unknown; readonly publishedThemes?: unknown } | undefined,
  input: Readonly<Record<string, unknown>>,
) =>
  readEnvironmentThemes(
    typeof world?.defaultTheme === "string" ? world.defaultTheme : "",
    Array.isArray(world?.publishedThemes)
      ? (world.publishedThemes as ReadonlyArray<EnvironmentTheme>)
      : [],
    typeof input.themeId === "string" ? input.themeId : undefined,
  ).pipe(
    Effect.map((read) => ({ isError: false as const, value: themeReadResult(read) })),
    Effect.catch((error) => Effect.succeed({ isError: true as const, value: error.message })),
  );
