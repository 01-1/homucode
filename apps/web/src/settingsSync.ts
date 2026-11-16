import type { EnvironmentId } from "@t3tools/contracts";
import type { SyncedClientSettings } from "@t3tools/contracts/settings";
import {
  type ClientSettingsSyncChoice,
  type ClientSettingsSyncConflict,
  clientSettingsPatchFromSyncedValues,
  planClientSettingsSync,
  resolveClientSettingsSync,
  type SyncedValues,
  syncedValuesEqual,
  syncedValuesFromClientSettings,
} from "@t3tools/client-runtime/state/client-settings-sync";
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
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { primaryServerConfigAtom, serverEnvironment } from "~/state/server";

const BASE_STORAGE_PREFIX = "t3code:client-settings-sync-base:v1:";
const LOCAL_CHANGE_DELAY_MS = 800;

export interface SettingsSyncPrompt {
  readonly environmentId: EnvironmentId;
  /** True when this device has never synced with the server. */
  readonly firstSetup: boolean;
  readonly conflicts: ReadonlyArray<ClientSettingsSyncConflict>;
}

let prompt: SettingsSyncPrompt | null = null;
let lastIgnoredWrite: string | null = null;
let promptDeferred = false;
let choices: Readonly<Record<string, ClientSettingsSyncChoice>> | null = null;
const promptListeners = new Set<() => void>();

function setPrompt(next: SettingsSyncPrompt | null): void {
  if (prompt === next) return;
  prompt = next;
  for (const listener of promptListeners) listener();
}

function subscribePrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

export function useSettingsSyncPrompt(): SettingsSyncPrompt | null {
  return useSyncExternalStore(
    subscribePrompt,
    () => prompt,
    () => null,
  );
}

/** Applies the user's side for every conflict and syncs. */
export function resolveSettingsSyncPrompt(
  nextChoices: Readonly<Record<string, ClientSettingsSyncChoice>>,
): void {
  choices = nextChoices;
  promptDeferred = false;
  setPrompt(null);
  requestSync();
}

/** Hides the prompt until the app restarts; nothing syncs until then. */
export function deferSettingsSyncPrompt(): void {
  promptDeferred = true;
  setPrompt(null);
}

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

/** Patches only what the merge changed, so edits made meanwhile survive the retry. */
async function applyLocally(values: SyncedValues, local: SyncedValues): Promise<void> {
  const changed = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !syncedValuesEqual({ value }, { value: local[key] }),
    ),
  );
  const patch = clientSettingsPatchFromSyncedValues(changed);
  await persistClientSettingsUpdate((current) => ({ ...current, ...patch }));
}

/** A write that lost a race with another device is dropped; the config stream then re-merges. */
async function writeRemote(
  environmentId: EnvironmentId,
  remote: SyncedClientSettings,
  values: SyncedValues,
): Promise<void> {
  const next = { revision: remote.revision + 1, values };
  // Servers from before sync ignore the write; do not resend it on every config event.
  const attempt = JSON.stringify([environmentId, next]);
  if (attempt === lastIgnoredWrite) return;
  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.updateSettings,
    { environmentId, input: { patch: { syncedClientSettings: next } } },
    { label: "settings sync", reportFailure: false },
  );
  if (result._tag !== "Success") {
    if (!isAtomCommandInterrupted(result)) {
      console.warn(
        "[SETTINGS_SYNC] could not save settings on the primary server",
        squashAtomCommandFailure(result),
      );
    }
    return;
  }
  const saved = result.value.syncedClientSettings;
  if (saved.revision === next.revision && syncedValuesEqual(saved.values, values)) {
    writeBase(environmentId, saved);
  } else if (saved.revision === remote.revision) {
    lastIgnoredWrite = attempt;
  }
}

async function syncOnce(): Promise<void> {
  if (!isClientSettingsHydrated()) return;
  const settings = getClientSettings();
  if (!settings.settingsSyncEnabled) {
    // Turning sync back on asks again even after "Decide later".
    promptDeferred = false;
    setPrompt(null);
    return;
  }
  const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  const config = appAtomRegistry.get(primaryServerConfigAtom);
  // Without the loaded config the default revision 0 would read as an empty server.
  if (promptDeferred || environmentId === null || config === null) return;
  const remote = config.settings.syncedClientSettings;
  const local = syncedValuesFromClientSettings(settings);
  const base = readBase(environmentId);
  if (base?.revision === remote.revision && syncedValuesEqual(local, base.values)) return;

  const plan = planClientSettingsSync({ local, base, remote });
  const resolved = resolveClientSettingsSync(plan, choices ?? {});
  if (resolved === undefined) {
    const firstSetup = base === null;
    if (
      prompt?.environmentId !== environmentId ||
      prompt.firstSetup !== firstSetup ||
      !syncedValuesEqual({ conflicts: prompt.conflicts }, { conflicts: plan.conflicts })
    ) {
      setPrompt({ environmentId, firstSetup, conflicts: plan.conflicts });
    }
    return;
  }
  choices = null;
  setPrompt(null);
  if (!syncedValuesEqual(resolved, local)) await applyLocally(resolved, local);
  if (syncedValuesEqual(resolved, remote.values)) {
    writeBase(environmentId, remote);
    return;
  }
  await writeRemote(environmentId, remote, resolved);
}

let running = false;
let rerun = false;

function requestSync(): void {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        rerun = false;
        await syncOnce();
      } while (rerun);
    } catch (error) {
      console.warn("[SETTINGS_SYNC] sync failed", error);
    } finally {
      running = false;
    }
  })();
}

/** Syncs this device's client settings through the primary server while sync is on. */
export function startClientSettingsSync(): () => void {
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  const onLocalChange = () => {
    if (localTimer !== null) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      requestSync();
    }, LOCAL_CHANGE_DELAY_MS);
  };
  const unsubscribes = [
    appAtomRegistry.subscribe(primaryServerConfigAtom, requestSync),
    subscribeClientSettingsHydration(requestSync),
    subscribeClientSettings(onLocalChange),
  ];
  requestSync();
  return () => {
    if (localTimer !== null) clearTimeout(localTimer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
