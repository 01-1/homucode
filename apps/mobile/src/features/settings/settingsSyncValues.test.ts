import { describe, expect, it } from "vite-plus/test";

import type { Preferences } from "../../persistence/mobile-preferences";
import {
  mobilePreferencesPatchFromSyncedValues,
  pickSettingsSyncEnvironment,
  syncedValuesFromMobilePreferences,
} from "./settingsSyncValues";

function apply(preferences: Preferences, changed: Record<string, unknown>): Preferences {
  return { ...preferences, ...mobilePreferencesPatchFromSyncedValues(changed, preferences) };
}

describe("phone settings sync values", () => {
  it("leaves out what the phone never set, so it takes the synced value", () => {
    expect(syncedValuesFromMobilePreferences({})).toEqual({});
    expect(
      syncedValuesFromMobilePreferences({
        projectGroupingEnabled: false,
        workingShelfEnabled: true,
      }),
    ).toEqual({ sidebarProjectGroupingMode: "separate", sidebarWorkingShelfEnabled: true });
  });

  it("maps the theme pair both ways and stays stable after applying it", () => {
    const fromWeb = {
      theme: "ocean",
      themeHalves: '{"dark":"ember"}',
      themeAppearanceMode: "dark",
    };
    const phone = apply({ themeId: "grove" }, fromWeb);

    expect(phone).toMatchObject({ lightThemeId: "ocean", darkThemeId: "ember", themeMode: "dark" });
    expect(syncedValuesFromMobilePreferences(phone)).toMatchObject(fromWeb);

    const changedOnPhone = {
      ...phone,
      lightThemeId: "iris" as const,
      darkThemeId: "iris" as const,
    };
    expect(syncedValuesFromMobilePreferences(changedOnPhone)).toMatchObject({
      theme: "iris",
      themeHalves: null,
    });
  });

  it("sends the standard theme as web's own, so web keeps the other half", () => {
    const phone: Preferences = { themeId: "ocean", lightThemeId: "t3-code", darkThemeId: "ocean" };

    expect(syncedValuesFromMobilePreferences(phone)).toMatchObject({
      theme: "system",
      themeHalves: '{"dark":"ocean"}',
    });
    expect(syncedValuesFromMobilePreferences({ themeId: "t3-code" })).toMatchObject({
      theme: "system",
      themeHalves: null,
    });
  });

  it("keeps a synced theme the phone cannot show instead of replacing it", () => {
    const fromWeb = { theme: "my-custom-theme", themeHalves: null };
    const phone = apply({ themeId: "grove" }, fromWeb);

    expect(phone).toMatchObject({ lightThemeId: "t3-code", darkThemeId: "t3-code" });
    expect(syncedValuesFromMobilePreferences(phone)).toMatchObject(fromWeb);
  });

  it("skips values the phone cannot read and clears a synced unset appearance", () => {
    const phone = apply(
      { followUpBehavior: "queue", themeMode: "light" },
      {
        followUpBehavior: "sometimes",
        themeAppearanceMode: null,
        sidebarProjectGroupingMode: "separate",
      },
    );

    expect(phone.followUpBehavior).toBe("queue");
    expect(phone.themeMode).toBeUndefined();
    expect(phone).toMatchObject({ projectGroupingMode: "separate", projectGroupingEnabled: false });
  });

  it("syncs only through a connected server, never one known only from its cached config", () => {
    expect(pickSettingsSyncEnvironment(["old", "live"], ["live"], undefined)).toBe("live");
    expect(pickSettingsSyncEnvironment(["old", "live"], ["live"], "old")).toBeNull();
    expect(pickSettingsSyncEnvironment(["live"], ["live"], "removed")).toBe("live");
  });
});
