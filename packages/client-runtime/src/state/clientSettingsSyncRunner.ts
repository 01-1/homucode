import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
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

export interface ClientSettingsSyncTarget {
  readonly environmentId: EnvironmentId;
  readonly remote: SyncedClientSettings;
}

/**
 * Every connected server whose config has loaded. A disconnected server's config is only a cache,
 * and without a config the default revision 0 would read as an empty server.
 */
export function settingsSyncTargets(
  connected: ReadonlyArray<EnvironmentId>,
  configs: ReadonlyMap<EnvironmentId, Pick<ServerConfig, "settings">>,
): ReadonlyArray<ClientSettingsSyncTarget> {
  return connected.flatMap((environmentId) => {
    const config = configs.get(environmentId);
    return config === undefined
      ? []
      : [{ environmentId, remote: config.settings.syncedClientSettings }];
  });
}

/** What a client provides so its settings sync through every server it is connected to. */
export interface ClientSettingsSyncAdapter {
  /** False until this device's own settings have loaded. */
  readonly isReady: () => boolean;
  readonly isEnabled: () => boolean;
  /** Each connected server whose copy has loaded. */
  readonly targets: () => ReadonlyArray<ClientSettingsSyncTarget>;
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
  /** Applies the user's side for every conflict of the shown prompt and syncs. */
  readonly resolvePrompt: (choices: Readonly<Record<string, ClientSettingsSyncChoice>>) => void;
  /** Hides the prompt until the app restarts; its server does not sync until then. */
  readonly deferPrompt: () => void;
}

export function createClientSettingsSyncRunner(
  adapter: ClientSettingsSyncAdapter,
): ClientSettingsSyncRunner {
  let prompt: SettingsSyncPrompt | null = null;
  let lastIgnoredWrite: string | null = null;
  const deferred = new Set<EnvironmentId>();
  let choices: {
    readonly environmentId: EnvironmentId;
    readonly values: Readonly<Record<string, ClientSettingsSyncChoice>>;
  } | null = null;
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

  /** False when this server's conflicts need the user, which leaves it unsynced for now. */
  const syncTarget = async (
    { environmentId, remote }: ClientSettingsSyncTarget,
    mayPrompt: boolean,
  ) => {
    const local = adapter.readLocal();
    const base = await adapter.readBase(environmentId);
    // Keys this client does not have are not its opinion, so they cannot make it out of date.
    if (
      base?.revision === remote.revision &&
      Object.entries(local).every(([key, value]) =>
        syncedValuesEqual({ value }, { value: base.values[key] }),
      )
    ) {
      return true;
    }

    const plan = planClientSettingsSync({ local, base, remote });
    const resolved = resolveClientSettingsSync(
      plan,
      choices?.environmentId === environmentId ? choices.values : {},
    );
    if (resolved === undefined) {
      if (!mayPrompt) return false;
      const firstSetup = base === null;
      if (
        prompt?.environmentId !== environmentId ||
        prompt.firstSetup !== firstSetup ||
        !syncedValuesEqual({ conflicts: prompt.conflicts }, { conflicts: plan.conflicts })
      ) {
        setPrompt({ environmentId, firstSetup, conflicts: plan.conflicts });
      }
      return false;
    }
    if (choices?.environmentId === environmentId) choices = null;
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
    } else {
      await writeRemote(environmentId, remote, resolved);
    }
    return true;
  };

  const syncOnce = async () => {
    if (!adapter.isReady()) return;
    if (!adapter.isEnabled()) {
      // Turning sync back on asks again even after "Decide later".
      deferred.clear();
      setPrompt(null);
      return;
    }
    const targets = adapter.targets().filter((target) => !deferred.has(target.environmentId));
    // One prompt at a time, and the one on screen keeps its place; other servers still sync.
    const ordered = [
      ...targets.filter((target) => target.environmentId === prompt?.environmentId),
      ...targets.filter((target) => target.environmentId !== prompt?.environmentId),
    ];
    let prompted = false;
    for (const target of ordered) {
      if (!(await syncTarget(target, !prompted))) prompted = true;
    }
    if (!prompted) setPrompt(null);
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
      if (prompt !== null) choices = { environmentId: prompt.environmentId, values: nextChoices };
      setPrompt(null);
      void requestSync();
    },
    deferPrompt: () => {
      if (prompt !== null) deferred.add(prompt.environmentId);
      setPrompt(null);
      void requestSync();
    },
  };
}
