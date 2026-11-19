import {
  DefaultThemePreference,
  EnvironmentThemeFile,
  EnvironmentThemeId,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as EnvironmentTheme from "../../../environmentTheme.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";

const Appearance = Schema.Literals(["light", "dark", "system"]);

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    EnvironmentTheme.EnvironmentThemeService,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
};

const ThemeReadTool = Tool.make("t3_theme_read", {
  ...shared,
  description:
    "Read T3 Code's own themes and the guide to restyle it: color roles and CSS selectors. `current` is the theme clients show. Call before `t3_theme_set`.",
  parameters: Schema.Struct({
    themeId: Schema.optionalKey(
      EnvironmentThemeId.annotate({
        description: "Also return this built-in or published theme's file.",
      }),
    ),
  }),
  success: Schema.Struct({
    current: DefaultThemePreference,
    currentNote: Schema.optionalKey(Schema.String),
    builtIn: Schema.Array(Schema.String),
    published: Schema.Array(
      Schema.Struct({
        id: EnvironmentThemeId,
        name: Schema.String,
        hasCss: Schema.Boolean,
        hasBackground: Schema.Boolean,
      }),
    ),
    theme: Schema.optionalKey(EnvironmentThemeFile),
    themesDir: Schema.String,
    guide: Schema.String,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ThemeSetTool = Tool.make("t3_theme_set", {
  ...shared,
  description:
    "Restyle T3 Code itself, only when the user asks. With `theme`, publish it as `themeId` (same id updates it) and switch this server's web app and this machine's desktop app to it, not remote desktop apps. With `base`, the published theme is `base` with only what `theme` sets changed. Without `theme`, switch to a built-in or published `themeId`, such as `lavender`, the default. `appearance` sets light, dark, or system mode. Asks the user first below full access.",
  parameters: Schema.Struct({
    themeId: Schema.optionalKey(EnvironmentThemeId),
    theme: Schema.optionalKey(EnvironmentThemeFile),
    base: Schema.optionalKey(
      EnvironmentThemeId.annotate({
        description:
          "Id of a built-in or published theme for `theme` to build on, such as `lavender`: its colors, variants, and CSS stay wherever `theme` does not set them, and `theme.css` follows its CSS. To change part of the look the user has now, give the id `t3_theme_read` returned as `current`.",
      }),
    ),
    appearance: Schema.optionalKey(Appearance),
  }),
  success: Schema.Struct({
    themeId: Schema.optionalKey(EnvironmentThemeId),
    appearance: Schema.optionalKey(Appearance),
    published: Schema.Boolean,
  }),
}).annotate(Tool.Destructive, true);

export const ThemeToolkit = Toolkit.make(ThemeReadTool, ThemeSetTool);
