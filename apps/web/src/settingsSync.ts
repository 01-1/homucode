import type { EnvironmentId } from "@t3tools/contracts";
import type { SyncedClientSettings } from "@t3tools/contracts/settings";
import {
  clientSettingsPatchFromSyncedValues,
  type SyncedValues,
  syncedValuesFromClientSettings,
} from "@t3tools/client-runtime/state/client-settings-sync";
import {
  createClientSettingsSyncRunner,
  type SettingsSyncPrompt,
} from "@t3tools/client-runtime/state/client-settings-sync-runner";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useSyncExternalStore } from "react";

import {
  getClientSettings,
  isClientSettingsHydrated,
  persistClientSettingsUpdate,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "~/hooks/useSettings";
import { refreshTheme, subscribeRenderedAppearance } from "~/hooks/useTheme";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { primaryServerConfigAtom, serverEnvironment } from "~/state/server";
import { invalidateCustomThemes, subscribeToCustomThemes } from "~/themePalette";
import { readThemeSyncValues, writeThemeSyncValues } from "~/themeSync";

export type { SettingsSyncPrompt };

const BASE_STORAGE_PREFIX = "t3code:client-settings-sync-base:v1:";
const LOCAL_CHANGE_DELAY_MS = 800;

function readBase(environmentId: EnvironmentId): SyncedClientSettings | null {
  try {
    const raw = localStorage.getItem(BASE_STORAGE_PREFIX + environmentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncedClientSettings;
    return typeof parsed?.revision === "number" &&
      parsed.values &&
      typeof parsed.values === "object"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeBase(environmentId: EnvironmentId, base: SyncedClientSettings): void {
  try {
    localStorage.setItem(BASE_STORAGE_PREFIX + environmentId, JSON.stringify(base));
  } catch {
    // Without a stored base the next sync treats this device as new and asks again.
  }
}

/** Client settings plus the theme choice, which lives in localStorage rather than client settings. */
function readLocalSyncedValues(): SyncedValues {
  let theme: SyncedValues = {};
  try {
    theme = readThemeSyncValues(localStorage);
  } catch {
    // Unreadable storage leaves the theme out of this sync.
  }
  return { ...syncedValuesFromClientSettings(getClientSettings()), ...theme };
}

async function applyLocally(changed: SyncedValues): Promise<void> {
  let themeChanged = false;
  try {
    themeChanged = writeThemeSyncValues(localStorage, changed);
  } catch (error) {
    console.warn("[SETTINGS_SYNC] could not apply the synced theme", error);
  }
  if (themeChanged) {
    invalidateCustomThemes();
    refreshTheme();
  }
  const patch = clientSettingsPatchFromSyncedValues(changed);
  await persistClientSettingsUpdate((current) => ({ ...current, ...patch }));
}

async function writeRemote(
  environmentId: EnvironmentId,
  next: SyncedClientSettings,
): Promise<SyncedClientSettings | null> {
  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.updateSettings,
    { environmentId, input: { patch: { syncedClientSettings: next } } },
    { label: "settings sync", reportFailure: false },
  );
  if (result._tag === "Success") return result.value.syncedClientSettings;
  if (!isAtomCommandInterrupted(result)) {
    console.warn(
      "[SETTINGS_SYNC] could not save settings on the primary server",
      squashAtomCommandFailure(result),
    );
  }
  return null;
}

const runner = createClientSettingsSyncRunner({
  isReady: isClientSettingsHydrated,
  isEnabled: () => getClientSettings().settingsSyncEnabled,
  target: () => {
    const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
    const config = appAtomRegistry.get(primaryServerConfigAtom);
    // Without the loaded config the default revision 0 would read as an empty server.
    if (environmentId === null || config === null) return null;
    return { environmentId, remote: config.settings.syncedClientSettings };
  },
  readLocal: readLocalSyncedValues,
  applyLocal: applyLocally,
  readBase,
  writeBase,
  writeRemote,
  onError: (error) => console.warn("[SETTINGS_SYNC] sync failed", error),
});

export function useSettingsSyncPrompt(): SettingsSyncPrompt | null {
  return useSyncExternalStore(runner.subscribePrompt, runner.getPrompt, () => null);
}

export const resolveSettingsSyncPrompt = runner.resolvePrompt;
export const deferSettingsSyncPrompt = runner.deferPrompt;

/** Syncs this device's client settings through the primary server while sync is on. */
export function startClientSettingsSync(): () => void {
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  const onLocalChange = () => {
    if (localTimer !== null) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      runner.requestSync();
    }, LOCAL_CHANGE_DELAY_MS);
  };
  const unsubscribes = [
    appAtomRegistry.subscribe(primaryServerConfigAtom, runner.requestSync),
    subscribeClientSettingsHydration(runner.requestSync),
    subscribeClientSettings(onLocalChange),
    subscribeRenderedAppearance(onLocalChange),
    subscribeToCustomThemes(onLocalChange),
  ];
  runner.requestSync();
  return () => {
    if (localTimer !== null) clearTimeout(localTimer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
