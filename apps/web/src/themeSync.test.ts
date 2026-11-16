import { describe, expect, it } from "vite-plus/test";

import { readThemeSyncValues, writeThemeSyncValues } from "./themeSync";
import {
  CUSTOM_THEMES_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./themePalette";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    items,
  };
}

describe("theme sync", () => {
  it("carries a cleared theme choice to other devices", () => {
    const source = memoryStorage({ [THEME_STORAGE_KEY]: "ocean" });
    const target = memoryStorage({
      [THEME_STORAGE_KEY]: "dracula",
      [THEME_HALVES_STORAGE_KEY]: '{"dark":"dracula"}',
      [CUSTOM_THEMES_STORAGE_KEY]: "[]",
    });

    expect(writeThemeSyncValues(target, readThemeSyncValues(source))).toBe(true);

    expect(readThemeSyncValues(target)).toEqual(readThemeSyncValues(source));
    expect(target.items.has(THEME_HALVES_STORAGE_KEY)).toBe(false);
    expect(writeThemeSyncValues(target, readThemeSyncValues(source))).toBe(false);
  });

  it("leaves themes alone for values an older device did not send or could not read", () => {
    const target = memoryStorage({ [THEME_STORAGE_KEY]: "ocean" });

    expect(writeThemeSyncValues(target, { themeHalves: 3 })).toBe(false);

    expect(target.items.get(THEME_STORAGE_KEY)).toBe("ocean");
  });
});
