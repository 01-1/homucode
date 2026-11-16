import {
  CUSTOM_THEMES_STORAGE_KEY,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./themePalette";

/** Synced setting key to the localStorage key that holds the theme choice on this device. */
const THEME_SYNC_STORAGE_KEYS = {
  theme: THEME_STORAGE_KEY,
  themeAppearanceMode: THEME_APPEARANCE_MODE_STORAGE_KEY,
  themeHalves: THEME_HALVES_STORAGE_KEY,
  customThemes: CUSTOM_THEMES_STORAGE_KEY,
} as const;

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Unset is null, not absent: the merge reads an absent key as no opinion, so clearing would never sync. */
export function readThemeSyncValues(storage: ThemeStorage): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(THEME_SYNC_STORAGE_KEYS).map(([key, storageKey]) => [
      key,
      storage.getItem(storageKey),
    ]),
  );
}

/** Writes the synced theme values that differ from storage; true when any changed. */
export function writeThemeSyncValues(
  storage: ThemeStorage,
  values: Readonly<Record<string, unknown>>,
): boolean {
  let changed = false;
  for (const [key, storageKey] of Object.entries(THEME_SYNC_STORAGE_KEYS)) {
    if (!Object.hasOwn(values, key)) continue;
    const value = values[key];
    if (value !== null && typeof value !== "string") continue;
    if (storage.getItem(storageKey) === value) continue;
    if (value === null) storage.removeItem(storageKey);
    else storage.setItem(storageKey, value);
    changed = true;
  }
  return changed;
}
