import {
  type ClientSettings,
  type ClientSettingsPatch,
  ClientSettingsSchema,
  type SyncedClientSettings,
} from "@t3tools/contracts/settings";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

/** Settings that describe this device rather than the user's preferences. */
const DEVICE_LOCAL_KEYS = new Set<string>([
  "settingsSyncEnabled",
  "fasterPhoneLaunch",
  "onboardingCompletedAt",
  "scratchEnvironmentId",
  "voiceMicrophone",
  "voiceMicrophones",
  // Another device or the server must never turn on code execution here.
  "appScriptsEnabled",
  "appScriptsFromTerminal",
  "appScriptsFromAgents",
] satisfies ReadonlyArray<keyof ClientSettings>);

export type SyncedValues = Readonly<Record<string, unknown>>;

export interface ClientSettingsSyncConflict {
  readonly key: string;
  readonly local: unknown;
  readonly remote: unknown;
}

export interface ClientSettingsSyncPlan {
  /** Every key that merged cleanly; conflicting keys are absent until resolved. */
  readonly merged: SyncedValues;
  readonly conflicts: ReadonlyArray<ClientSettingsSyncConflict>;
}

export type ClientSettingsSyncChoice = "local" | "remote";

const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const decodeClientSettingsExit = Schema.decodeUnknownExit(ClientSettingsSchema);
const CLIENT_SETTINGS_KEYS = new Set(Object.keys(ClientSettingsSchema.fields));

function isSyncedClientSettingKey(key: string): boolean {
  return !DEVICE_LOCAL_KEYS.has(key);
}

export function syncedValuesFromClientSettings(settings: ClientSettings): SyncedValues {
  const encoded = encodeClientSettings(settings) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(encoded)) {
    if (isSyncedClientSettingKey(key)) values[key] = value;
  }
  return values;
}

/** Keys this client cannot read or that fail to decode stay on the server only. */
export function clientSettingsPatchFromSyncedValues(values: SyncedValues): ClientSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!CLIENT_SETTINGS_KEYS.has(key) || !isSyncedClientSettingKey(key)) continue;
    const exit = decodeClientSettingsExit({ [key]: value });
    if (Exit.isSuccess(exit)) patch[key] = (exit.value as Record<string, unknown>)[key];
  }
  return patch as ClientSettingsPatch;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

function syncedValueEquals(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function syncedValuesEqual(left: SyncedValues, right: SyncedValues): boolean {
  return syncedValueEquals(left, right);
}

/**
 * Three-way merge of this device's settings with the server's copy, against the copy this device
 * last synced. Without a base (first setup) every differing setting is a conflict, unless the
 * server has never been written.
 */
export function planClientSettingsSync(input: {
  readonly local: SyncedValues;
  readonly base: SyncedClientSettings | null;
  readonly remote: SyncedClientSettings;
}): ClientSettingsSyncPlan {
  const { local, base, remote } = input;
  if (base === null && remote.revision === 0) {
    return { merged: local, conflicts: [] };
  }
  const merged: Record<string, unknown> = {};
  const conflicts: Array<ClientSettingsSyncConflict> = [];
  const keys = new Set([
    ...Object.keys(local),
    ...Object.keys(remote.values),
    ...Object.keys(base?.values ?? {}),
  ]);
  for (const key of keys) {
    const hasRemote = Object.hasOwn(remote.values, key);
    const remoteValue = hasRemote ? remote.values[key] : undefined;
    // A key this client does not know has no local opinion.
    const localValue = Object.hasOwn(local, key) ? local[key] : remoteValue;
    const take = (value: unknown) => {
      if (value !== undefined) merged[key] = value;
    };
    if (syncedValueEquals(localValue, remoteValue)) {
      take(localValue);
    } else if (base === null) {
      // First setup: a setting only one side has is not a disagreement.
      if (!hasRemote) take(localValue);
      else conflicts.push({ key, local: localValue, remote: remoteValue });
    } else {
      const baseValue = base.values[key];
      if (syncedValueEquals(localValue, baseValue)) take(remoteValue);
      else if (syncedValueEquals(remoteValue, baseValue)) take(localValue);
      else conflicts.push({ key, local: localValue, remote: remoteValue });
    }
  }
  return { merged, conflicts };
}

/** Undefined when a conflict has no choice yet. */
export function resolveClientSettingsSync(
  plan: ClientSettingsSyncPlan,
  choices: Readonly<Record<string, ClientSettingsSyncChoice>>,
): SyncedValues | undefined {
  const values: Record<string, unknown> = { ...plan.merged };
  for (const conflict of plan.conflicts) {
    const choice = choices[conflict.key];
    if (choice === undefined) return undefined;
    const value = choice === "local" ? conflict.local : conflict.remote;
    if (value !== undefined) values[conflict.key] = value;
  }
  return values;
}

/** Synced settings that are not client settings, named for people. */
const SYNCED_SETTING_LABELS: Readonly<Record<string, string>> = {
  theme: "Theme",
  themeAppearanceMode: "Appearance",
  themeHalves: "Light and dark themes",
  customThemes: "Theme library",
};

export function syncedSettingLabel(key: string): string {
  const label = SYNCED_SETTING_LABELS[key];
  if (label !== undefined) return label;
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function syncedItemLabel(item: unknown, qualify: boolean): string {
  if (typeof item === "string") return item || "empty";
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    for (const field of ["model", "name", "label", "title", "id"]) {
      const value = record[field];
      if (typeof value !== "string" || !value) continue;
      return qualify && typeof record.provider === "string"
        ? `${value} (${record.provider})`
        : value;
    }
  }
  return stableJson(item);
}

function shorten(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function describeScalar(value: unknown): string {
  if (value === undefined || value === null) return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "string") return shorten(value || "empty");
  return shorten(stableJson(value));
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Some synced settings (the theme library, light and dark themes) are stored as JSON text. */
function decodeForDisplay(value: unknown): unknown {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function describeLists(
  local: ReadonlyArray<unknown>,
  remote: ReadonlyArray<unknown>,
): { readonly local: string; readonly remote: string } {
  const localKeys = local.map(stableJson);
  const remoteKeys = remote.map(stableJson);
  const onlyIn = (items: ReadonlyArray<unknown>, keys: string[], other: string[]) =>
    items.filter((_, index) => !other.includes(keys[index]!));
  const localOnly = onlyIn(local, localKeys, remoteKeys);
  const remoteOnly = onlyIn(remote, remoteKeys, localKeys);
  if (localOnly.length === 0 && remoteOnly.length === 0) {
    // Same items in another order: show each side's order from the first position that differs.
    const start = Math.max(
      0,
      localKeys.findIndex((key, index) => key !== remoteKeys[index]),
    );
    const order = (items: ReadonlyArray<unknown>) =>
      `${countLabel(items.length, "item")}, from #${start + 1}: ${shorten(
        items
          .slice(start)
          .map((item) => syncedItemLabel(item, true))
          .join(", "),
        48,
      )}`;
    return { local: order(local), remote: order(remote) };
  }
  const plainRemote = new Set(remoteOnly.map((item) => syncedItemLabel(item, false)));
  const qualify = localOnly.some((item) => plainRemote.has(syncedItemLabel(item, false)));
  const side = (items: ReadonlyArray<unknown>, extra: ReadonlyArray<unknown>) => {
    const count = countLabel(items.length, "item");
    if (extra.length === 0) return count;
    const labels = extra.map((item) => syncedItemLabel(item, qualify)).join(", ");
    return `${count}, incl. ${shorten(labels, 48)}`;
  };
  return { local: side(local, localOnly), remote: side(remote, remoteOnly) };
}

/**
 * Human-readable sides of a conflict. Lists and objects name what differs instead of dumping
 * JSON, since both sides usually share a long common prefix.
 */
export function describeSyncedSettingConflict(conflict: ClientSettingsSyncConflict): {
  readonly local: string;
  readonly remote: string;
} {
  const local = decodeForDisplay(conflict.local);
  const remote = decodeForDisplay(conflict.remote);
  if (Array.isArray(local) && Array.isArray(remote)) return describeLists(local, remote);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (isRecord(local) && isRecord(remote)) {
    const differing = [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter(
      (key) => !syncedValueEquals(local[key], remote[key]),
    );
    const describeSide = (side: Record<string, unknown>) =>
      shorten(
        differing
          .map((key) => `${syncedSettingLabel(key)}: ${describeScalar(side[key])}`)
          .join(", "),
      );
    return { local: describeSide(local), remote: describeSide(remote) };
  }
  return { local: describeScalar(local), remote: describeScalar(remote) };
}
