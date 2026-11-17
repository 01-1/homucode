import {
  type EnvironmentTheme,
  type EnvironmentThemeFile,
  THEME_CSS_MAX_LENGTH,
} from "@t3tools/contracts";
import { BUILT_IN_THEMES, type ThemeAppearance } from "./themePalettes.ts";

/** A built-in or published theme as a theme file, so agents can read it and build on it. */
export function findThemeFile(
  themes: ReadonlyArray<EnvironmentTheme>,
  themeId: string,
): EnvironmentThemeFile | undefined {
  const builtIn = BUILT_IN_THEMES.find((theme) => theme.id === themeId);
  if (builtIn !== undefined) {
    return {
      name: builtIn.label,
      appearance: builtIn.appearance,
      colors: builtIn.colors,
      ...(builtIn.variants ? { variants: builtIn.variants } : {}),
      ...(builtIn.css ? { css: builtIn.css } : {}),
    };
  }
  const published = themes.find((theme) => theme.id === themeId);
  if (published === undefined) return undefined;
  const { id: _id, ...file } = published;
  return file;
}

/**
 * `theme` laid over `base`: roles `theme` sets replace the base's, every other color, variant, and
 * CSS rule of the base stays, and `theme.css` comes after the base's. `theme.colors` describes
 * `theme.appearance`, so it lands on the base's variant when the two appearances differ.
 * Returns the problem, ending a sentence, when the result is not a theme.
 */
export function themeOnBase(
  base: EnvironmentThemeFile,
  theme: EnvironmentThemeFile,
): EnvironmentThemeFile | { readonly problem: string } {
  if (theme.canvas !== undefined || theme.accent !== undefined) {
    return {
      problem:
        "sets canvas or accent, which derive a whole new palette. With a base, set single roles in `colors` or `variants`.",
    };
  }
  const rolesFor = (appearance: ThemeAppearance) =>
    appearance === theme.appearance
      ? { ...theme.variants?.[appearance], ...theme.colors }
      : theme.variants?.[appearance];
  const other: ThemeAppearance = base.appearance === "light" ? "dark" : "light";
  const colors = { ...base.colors, ...rolesFor(base.appearance) };
  const baseOther = base.variants?.[other];
  const otherColors =
    baseOther === undefined && rolesFor(other) === undefined
      ? undefined
      : { ...baseOther, ...rolesFor(other) };
  const css = [base.css, theme.css].filter(Boolean).join("\n");
  if (css.length > THEME_CSS_MAX_LENGTH) {
    return {
      problem: `has more CSS than fits with the base's: ${THEME_CSS_MAX_LENGTH} characters in all.`,
    };
  }
  return {
    name: theme.name,
    appearance: base.appearance,
    ...(base.canvas === undefined ? {} : { canvas: base.canvas }),
    ...(base.accent === undefined ? {} : { accent: base.accent }),
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
    ...(otherColors === undefined
      ? {}
      : { variants: other === "light" ? { light: otherColors } : { dark: otherColors } }),
    ...(css.length > 0 ? { css } : {}),
  };
}
