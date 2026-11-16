import type { EnvironmentId } from "@t3tools/contracts";
import type { SyncedClientSettings } from "@t3tools/contracts/settings";

import {
  type ClientSettingsSyncChoice,
  type ClientSettingsSyncConflict,
  planClientSettingsSync,
  resolveClientSettingsSync,
  type SyncedValues,
  syncedValuesEqual,
} from "./clientSettingsSync.ts";

export interface SettingsSyncPrompt {
  readonly environmentId: EnvironmentId;
  /** True when this device has never synced with the server. */
  readonly firstSetup: boolean;
  readonly conflicts: ReadonlyArray<ClientSettingsSyncConflict>;
}

/** What a client provides so its settings sync through one server. */
export interface ClientSettingsSyncAdapter {
  /** False until this device's own settings have loaded. */
  readonly isReady: () => boolean;
  readonly isEnabled: () => boolean;
  /** The server this device syncs through and its copy, or null while unknown. */
  readonly target: () => {
    readonly environmentId: EnvironmentId;
    readonly remote: SyncedClientSettings;
  } | null;
  readonly readLocal: () => SyncedValues;
  /** Applies only the values the merge changed, so edits made meanwhile survive. */
  readonly applyLocal: (changed: SyncedValues) => Promise<void>;
  readonly readBase: (
    environmentId: EnvironmentId,
  ) => SyncedClientSettings | null | Promise<SyncedClientSettings | null>;
  readonly writeBase: (
    environmentId: EnvironmentId,
    base: SyncedClientSettings,
  ) => void | Promise<void>;
  /** The server's copy after the write, or null when the write failed. */
  readonly writeRemote: (
    environmentId: EnvironmentId,
    next: SyncedClientSettings,
  ) => Promise<SyncedClientSettings | null>;
  readonly onError: (error: unknown) => void;
}

export interface ClientSettingsSyncRunner {
  /** Resolves when this and any sync it queued behind have finished. */
  readonly requestSync: () => Promise<void>;
  readonly getPrompt: () => SettingsSyncPrompt | null;
  readonly subscribePrompt: (listener: () => void) => () => void;
  /** Applies the user's side for every conflict and syncs. */
  readonly resolvePrompt: (choices: Readonly<Record<string, ClientSettingsSyncChoice>>) => void;
  /** Hides the prompt until the app restarts; nothing syncs until then. */
  readonly deferPrompt: () => void;
}

export function createClientSettingsSyncRunner(
  adapter: ClientSettingsSyncAdapter,
): ClientSettingsSyncRunner {
  let prompt: SettingsSyncPrompt | null = null;
  let lastIgnoredWrite: string | null = null;
  let promptDeferred = false;
  let choices: Readonly<Record<string, ClientSettingsSyncChoice>> | null = null;
  const promptListeners = new Set<() => void>();

  const setPrompt = (next: SettingsSyncPrompt | null) => {
    if (prompt === next) return;
    prompt = next;
    for (const listener of promptListeners) listener();
  };

  /** A write that lost a race with another device is dropped; the next config update re-merges. */
  const writeRemote = async (
    environmentId: EnvironmentId,
    remote: SyncedClientSettings,
    values: SyncedValues,
  ) => {
    const next = { revision: remote.revision + 1, values };
    // Servers from before sync ignore the write; do not resend it on every config event.
    const attempt = JSON.stringify([environmentId, next]);
    if (attempt === lastIgnoredWrite) return;
    const saved = await adapter.writeRemote(environmentId, next);
    if (saved === null) return;
    if (saved.revision === next.revision && syncedValuesEqual(saved.values, values)) {
      await adapter.writeBase(environmentId, saved);
    } else if (saved.revision === remote.revision) {
      lastIgnoredWrite = attempt;
    }
  };

  const syncOnce = async () => {
    if (!adapter.isReady()) return;
    if (!adapter.isEnabled()) {
      // Turning sync back on asks again even after "Decide later".
      promptDeferred = false;
      setPrompt(null);
      return;
    }
    const target = adapter.target();
    if (promptDeferred || target === null) return;
    const { environmentId, remote } = target;
    const local = adapter.readLocal();
    const base = await adapter.readBase(environmentId);
    // Keys this client does not have are not its opinion, so they cannot make it out of date.
    if (
      base?.revision === remote.revision &&
      Object.entries(local).every(([key, value]) =>
        syncedValuesEqual({ value }, { value: base.values[key] }),
      )
    ) {
      return;
    }

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
    if (!syncedValuesEqual(resolved, local)) {
      await adapter.applyLocal(
        Object.fromEntries(
          Object.entries(resolved).filter(
            ([key, value]) => !syncedValuesEqual({ value }, { value: local[key] }),
          ),
        ),
      );
    }
    if (syncedValuesEqual(resolved, remote.values)) {
      await adapter.writeBase(environmentId, remote);
      return;
    }
    await writeRemote(environmentId, remote, resolved);
  };

  let running: Promise<void> | null = null;
  let rerun = false;

  const requestSync = (): Promise<void> => {
    if (running !== null) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          await syncOnce();
        } while (rerun);
      } catch (error) {
        adapter.onError(error);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return {
    requestSync,
    getPrompt: () => prompt,
    subscribePrompt: (listener) => {
      promptListeners.add(listener);
      return () => promptListeners.delete(listener);
    },
    resolvePrompt: (nextChoices) => {
      choices = nextChoices;
      promptDeferred = false;
      setPrompt(null);
      void requestSync();
    },
    deferPrompt: () => {
      promptDeferred = true;
      setPrompt(null);
    },
  };
}
