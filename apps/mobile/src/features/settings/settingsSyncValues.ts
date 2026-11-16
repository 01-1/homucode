import type { SyncedValues } from "@t3tools/client-runtime/state/client-settings-sync";
import { ModelFavorites, ToolCallVisibility } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

import type { Preferences } from "../../persistence/mobile-preferences";
import { normalizeMobileThemeId, resolveMobileThemeIds } from "../../lib/mobileTheme";
import {
  mobileProjectGroupingModePatch,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping.logic";

const isBoolean = (value: unknown) => typeof value === "boolean";

/** Synced setting key to the phone preference that holds the same choice, and its check. */
const PREFERENCES = {
  followUpBehavior: ["followUpBehavior", Schema.is(Schema.Literals(["queue", "steer"]))],
  language: ["language", (value: unknown) => typeof value === "string"],
  mathRenderingEnabled: ["mathRenderingEnabled", isBoolean],
  toolCallVisibility: ["toolCallVisibility", Schema.is(ToolCallVisibility)],
  favorites: ["modelFavorites", Schema.is(ModelFavorites)],
  sidebarWorkingShelfEnabled: ["workingShelfEnabled", isBoolean],
  themeAppearanceMode: ["themeMode", Schema.is(Schema.Literals(["light", "dark", "system"]))],
} as const satisfies Record<string, readonly [keyof Preferences, (value: unknown) => boolean]>;

interface SyncedTheme {
  readonly theme: unknown;
  readonly themeHalves: unknown;
}

function themeIdsFromSynced({ theme, themeHalves }: SyncedTheme) {
  let halves: { light?: unknown; dark?: unknown } = {};
  if (typeof themeHalves === "string") {
    try {
      const parsed: unknown = JSON.parse(themeHalves);
      if (typeof parsed === "object" && parsed !== null) halves = parsed;
    } catch {}
  }
  return {
    light: normalizeMobileThemeId(halves.light ?? theme),
    dark: normalizeMobileThemeId(halves.dark ?? theme),
  };
}

/**
 * The phone's settings as synced values. A preference the phone never set is left out, so it
 * takes the synced value instead of conflicting with it.
 */
export function syncedValuesFromMobilePreferences(preferences: Preferences): SyncedValues {
  const values: Record<string, unknown> = {};
  for (const [key, [preferenceKey]] of Object.entries(PREFERENCES)) {
    const value = preferences[preferenceKey];
    if (value !== undefined) values[key] = value;
  }
  if (
    preferences.projectGroupingMode !== undefined ||
    preferences.projectGroupingEnabled !== undefined
  ) {
    values.sidebarProjectGroupingMode =
      resolveMobileProjectGroupingSettings(preferences).sidebarProjectGroupingMode;
  }
  if (
    preferences.themeId !== undefined ||
    preferences.lightThemeId !== undefined ||
    preferences.darkThemeId !== undefined
  ) {
    const ids = resolveMobileThemeIds(preferences);
    const echo = preferences.settingsSyncTheme;
    // A synced theme the phone cannot show is kept as synced until the phone picks another.
    if (echo !== undefined && echo.light === ids.light && echo.dark === ids.dark) {
      values.theme = echo.theme;
      values.themeHalves = echo.themeHalves;
    } else if (ids.light === ids.dark) {
      values.theme = ids.light;
      values.themeHalves = null;
    } else {
      values.theme = preferences.themeId ?? ids.light;
      values.themeHalves = JSON.stringify({ light: ids.light, dark: ids.dark });
    }
  }
  return values;
}

/** The preference patch for synced values that changed; values the phone cannot read are skipped. */
export function mobilePreferencesPatchFromSyncedValues(
  changed: SyncedValues,
  preferences: Preferences,
): Partial<Preferences> {
  const patch: Record<string, unknown> = {};
  for (const [key, [preferenceKey, isValid]] of Object.entries(PREFERENCES)) {
    if (!Object.hasOwn(changed, key)) continue;
    const value = changed[key];
    // Synced null means unset.
    if (value === null) patch[preferenceKey] = undefined;
    else if (isValid(value)) patch[preferenceKey] = value;
  }

  const grouping = changed.sidebarProjectGroupingMode;
  if (grouping === "repository" || grouping === "repository_path" || grouping === "separate") {
    Object.assign(patch, mobileProjectGroupingModePatch(grouping));
  }

  if (Object.hasOwn(changed, "theme") || Object.hasOwn(changed, "themeHalves")) {
    const current = syncedValuesFromMobilePreferences(preferences);
    const synced: SyncedTheme = {
      theme: Object.hasOwn(changed, "theme") ? changed.theme : (current.theme ?? null),
      themeHalves: Object.hasOwn(changed, "themeHalves")
        ? changed.themeHalves
        : (current.themeHalves ?? null),
    };
    const ids = themeIdsFromSynced(synced);
    Object.assign(patch, {
      themeId: ids.light === ids.dark ? ids.light : (preferences.themeId ?? ids.light),
      lightThemeId: ids.light,
      darkThemeId: ids.dark,
      settingsSyncTheme: { ...synced, ...ids },
    });
  }
  return patch as Partial<Preferences>;
}
