import { EnvironmentThemeFile } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { findThemeFile, themeOnBase } from "./themeBase.ts";
import { BUILT_IN_THEME_IDS, HOMU_THEME } from "./themePalettes.ts";

const lavenderDark = HOMU_THEME.variants?.dark;
const isThemeFile = Schema.is(EnvironmentThemeFile);

describe("findThemeFile", () => {
  it("returns every built-in as a theme file the server accepts", () => {
    for (const themeId of BUILT_IN_THEME_IDS) {
      const file = findThemeFile([], themeId);
      expect(file && isThemeFile(file)).toBe(true);
    }
    expect(findThemeFile([], "lavender")?.css).toBe(HOMU_THEME.css);
  });

  it("finds published themes and nothing else", () => {
    const published = {
      id: "look",
      name: "Look",
      appearance: "dark",
      canvas: "#000000",
      accent: "#ffffff",
    } as const;
    expect(findThemeFile([published], "look")).toEqual({
      name: "Look",
      appearance: "dark",
      canvas: "#000000",
      accent: "#ffffff",
    });
    expect(findThemeFile([published], "missing")).toBeUndefined();
  });
});

describe("themeOnBase", () => {
  const lavender = findThemeFile([], "lavender")!;

  it("changes only the roles the theme sets and keeps the base's CSS first", () => {
    const built = themeOnBase(lavender, {
      name: "Lavender Darker",
      appearance: "dark",
      colors: { messageSurface: "#1a0030" },
      css: '.dark [data-slot="composer-host"]{background:#120020!important}',
    });
    expect(built).toEqual({
      name: "Lavender Darker",
      appearance: "light",
      colors: HOMU_THEME.colors,
      variants: { dark: { ...lavenderDark, messageSurface: "#1a0030" } },
      css: `${HOMU_THEME.css}\n.dark [data-slot="composer-host"]{background:#120020!important}`,
    });
  });

  it("puts roles for the base's own appearance on its colors", () => {
    const built = themeOnBase(lavender, {
      name: "Lavender Plus",
      appearance: "light",
      colors: { canvas: "#ffffff" },
      variants: { dark: { canvas: "#050505" } },
    });
    expect(built).toMatchObject({
      colors: { ...HOMU_THEME.colors, canvas: "#ffffff" },
      variants: { dark: { ...lavenderDark, canvas: "#050505" } },
    });
  });

  it("refuses seeds that would derive a new palette, and CSS that does not fit", () => {
    expect(
      themeOnBase(lavender, {
        name: "Seeded",
        appearance: "dark",
        canvas: "#000000",
        accent: "#ffffff",
      }),
    ).toMatchObject({ problem: expect.stringMatching(/canvas or accent/) });
    expect(
      themeOnBase(lavender, { name: "Long", appearance: "light", css: "x".repeat(50_000) }),
    ).toMatchObject({ problem: expect.stringMatching(/CSS/) });
  });
});
