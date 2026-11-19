import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { THEME_GUIDE } from "@t3tools/shared/themeCss";
import { BUILT_IN_THEME_IDS, DEFAULT_THEME_ID } from "@t3tools/shared/themePalettes";
import * as Effect from "effect/Effect";
import * as EnvironmentTheme from "../../../environmentTheme.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { ThemeToolkit } from "./tools.ts";

/** `t3_theme_read`'s answer for what the theme service read. */
export const themeReadResult = ({
  current,
  themesDir,
  themes,
  theme,
}: EnvironmentTheme.EnvironmentThemeRead) => ({
  current: current || DEFAULT_THEME_ID,
  ...(current
    ? {}
    : {
        currentNote: `No environment theme is set, so each client shows its own pick: ${DEFAULT_THEME_ID}, the default, unless the user chose another there.`,
      }),
  builtIn: BUILT_IN_THEME_IDS,
  published: themes.map(({ id, name, css, background }) => ({
    id,
    name,
    hasCss: Boolean(css),
    hasBackground: background !== undefined,
  })),
  ...(themesDir === undefined ? {} : { themesDir }),
  ...(theme === undefined ? {} : { theme }),
  guide: THEME_GUIDE,
});

export const layer = McpToolAccess.toLayer(ThemeToolkit, {
  t3_theme_read: McpToolAccess.reads(({ themeId }) =>
    Effect.gen(function* () {
      const themes = yield* EnvironmentTheme.EnvironmentThemeService;
      const read = yield* themes.read(themeId).pipe(
        Effect.catchTags({
          EnvironmentThemeRefusedError: (error) =>
            Effect.fail(
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
            ),
          ServerSettingsError: () => Effect.fail(unavailable()),
        }),
      );
      return { ...themeReadResult(read), themesDir: read.themesDir };
    }),
  ),
  t3_theme_set: McpToolAccess.writesEnvironment(
    ({ themeId, theme, base, appearance }, check) =>
      Effect.gen(function* () {
        const input =
          themeId !== undefined && (base === undefined || theme !== undefined)
            ? { themeId, theme, base, appearance }
            : theme === undefined && base === undefined && appearance !== undefined
              ? { appearance }
              : undefined;
        if (input === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "Give `themeId`, `appearance`, or both. `theme` needs a `themeId`, and `base` needs a `theme`.",
          });
        }
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
        const themes = yield* EnvironmentTheme.EnvironmentThemeService;
        const set = Effect.gen(function* () {
          // The turn may have ended, or the thread's modes changed, while this waited for the lock.
          yield* check;
          yield* themes.apply(input).pipe(
            Effect.catchTags({
              EnvironmentThemeRefusedError: (error) =>
                Effect.fail(
                  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
                ),
              EnvironmentThemeNotSelectedError: () => Effect.fail(unavailable()),
            }),
          );
          return {
            ...(themeId === undefined ? {} : { themeId }),
            ...(appearance === undefined ? {} : { appearance }),
            published: theme !== undefined,
          };
        });
        return yield* scope.thread === undefined
          ? set
          : executor.withLock(scope.thread.threadId, set);
      }),
    { approval: McpToolAccess.approvalPrompt("change the environment theme") },
  ),
});
