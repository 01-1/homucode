import type { EnvironmentId } from "@t3tools/contracts";
import { createClientSettingsSyncRunner } from "@t3tools/client-runtime/state/client-settings-sync-runner";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { AsyncResult } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { environmentCatalog } from "../../connection/catalog";
import type { Preferences } from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import {
  mobilePreferencesPatchFromSyncedValues,
  syncedValuesFromMobilePreferences,
} from "./settingsSyncValues";

const LOCAL_CHANGE_DELAY_MS = 800;

function readPreferences(): Preferences | null {
  const result = appAtomRegistry.get(mobilePreferencesAtom);
  return AsyncResult.isSuccess(result) ? result.value : null;
}

function savePreferences(transform: (current: Preferences) => Partial<Preferences>): void {
  appAtomRegistry.set(updateMobilePreferencesAtom, { transform });
}

/**
 * The server the phone first synced through, while it stays paired; otherwise the first paired
 * server whose config has loaded.
 */
function syncEnvironmentId(preferences: Preferences): EnvironmentId | null {
  const enabled = [
    ...enabledEnvironmentIds(appAtomRegistry.get(environmentCatalog.catalogValueAtom)),
  ];
  const saved = enabled.find((id) => id === preferences.settingsSyncEnvironmentId);
  if (saved !== undefined) return saved;
  const configs = appAtomRegistry.get(environmentServerConfigsAtom);
  return enabled.find((id) => configs.has(id)) ?? null;
}

const runner = createClientSettingsSyncRunner({
  isReady: () => readPreferences() !== null,
  isEnabled: () => readPreferences()?.settingsSyncEnabled !== false,
  target: () => {
    const preferences = readPreferences();
    if (preferences === null) return null;
    const environmentId = syncEnvironmentId(preferences);
    const config =
      environmentId === null
        ? undefined
        : appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    // Without the loaded config the default revision 0 would read as an empty server.
    if (environmentId === null || config === undefined) return null;
    return { environmentId, remote: config.settings.syncedClientSettings };
  },
  readLocal: () => syncedValuesFromMobilePreferences(readPreferences() ?? {}),
  applyLocal: async (changed) => {
    const preferences = readPreferences();
    if (preferences === null) return;
    const patch = mobilePreferencesPatchFromSyncedValues(changed, preferences);
    // Settings only web has come through as changes; writing nothing would still wake sync.
    if (Object.keys(patch).length > 0) savePreferences(() => patch);
  },
  readBase: (environmentId) => readPreferences()?.settingsSyncBases?.[environmentId] ?? null,
  writeBase: (environmentId, base) => {
    savePreferences((current) => ({
      settingsSyncEnvironmentId: environmentId,
      settingsSyncBases: { ...current.settingsSyncBases, [environmentId]: base },
    }));
  },
  writeRemote: async (environmentId, next) => {
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.updateSettings,
      { environmentId, input: { patch: { syncedClientSettings: next } } },
      { label: "settings sync", reportFailure: false },
    );
    if (result._tag === "Success") return result.value.syncedClientSettings;
    if (!isAtomCommandInterrupted(result)) {
      console.warn(
        "[SETTINGS_SYNC] could not save settings on the server",
        squashAtomCommandFailure(result),
      );
    }
    return null;
  },
  onError: (error) => console.warn("[SETTINGS_SYNC] sync failed", error),
});

export function useSettingsSyncPrompt() {
  return useSyncExternalStore(runner.subscribePrompt, runner.getPrompt, () => null);
}

export const resolveSettingsSyncPrompt = runner.resolvePrompt;
export const deferSettingsSyncPrompt = runner.deferPrompt;

let sheetOpen = false;

/** Tracks the conflict sheet, so a changed prompt does not open a second one. */
export function setSettingsSyncSheetOpen(open: boolean): void {
  sheetOpen = open;
}

/** Syncs the phone's settings through one paired server while sync is on. */
export function installClientSettingsSync(openSheet: () => void): () => void {
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  const onLocalChange = () => {
    if (localTimer !== null) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      runner.requestSync();
    }, LOCAL_CHANGE_DELAY_MS);
  };
  const unsubscribes = [
    appAtomRegistry.subscribe(environmentServerConfigsAtom, runner.requestSync),
    appAtomRegistry.subscribe(mobilePreferencesAtom, onLocalChange),
    runner.subscribePrompt(() => {
      if (runner.getPrompt() !== null && !sheetOpen) openSheet();
    }),
  ];
  runner.requestSync();
  return () => {
    if (localTimer !== null) clearTimeout(localTimer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
