import {
  createClientSettingsSyncRunner,
  settingsSyncTargets,
} from "@t3tools/client-runtime/state/client-settings-sync-runner";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import type { Preferences } from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
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

const runner = createClientSettingsSyncRunner({
  isReady: () => readPreferences() !== null,
  isEnabled: () => readPreferences()?.settingsSyncEnabled === true,
  targets: () =>
    settingsSyncTargets(
      appAtomRegistry.get(connectedEnvironmentIdsAtom),
      appAtomRegistry.get(environmentServerConfigsAtom),
    ),
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
let openSheetForPrompt: (() => void) | null = null;

/** Tracks the conflict sheet, so a changed prompt does not open a second one. */
export function setSettingsSyncSheetOpen(open: boolean): void {
  sheetOpen = open;
  // The next server's prompt can arrive while the answered sheet is still closing.
  if (!open && runner.getPrompt() !== null) openSheetForPrompt?.();
}

/** Syncs the phone's settings with every connected server while sync is on. */
export function installClientSettingsSync(openSheet: () => void): () => void {
  openSheetForPrompt = openSheet;
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
    appAtomRegistry.subscribe(connectedEnvironmentIdsAtom, runner.requestSync),
    appAtomRegistry.subscribe(mobilePreferencesAtom, onLocalChange),
    runner.subscribePrompt(() => {
      if (runner.getPrompt() !== null && !sheetOpen) openSheet();
    }),
  ];
  runner.requestSync();
  return () => {
    openSheetForPrompt = null;
    if (localTimer !== null) clearTimeout(localTimer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
