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

function syncedItemLabel(item: unknown): string {
  if (typeof item === "string") return item || "empty";
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    for (const field of ["model", "name", "label", "title", "id"]) {
      const value = record[field];
      if (typeof value === "string" && value) return value;
    }
  }
  return stableJson(item);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The first field that differs between two values, as "path: value" for each side. */
function firstDifference(left: unknown, right: unknown, path = ""): [string, string] | null {
  if (syncedValueEquals(left, right)) return null;
  if (isPlainRecord(left) && isPlainRecord(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const found = firstDifference(left[key], right[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  const prefix = path ? `${path}: ` : "";
  if (typeof left === "string" && typeof right === "string") {
    // Long strings can share a long prefix; start the excerpt just before they part.
    let index = 0;
    while (index < left.length && left[index] === right[index]) index++;
    const from = Math.max(0, index - 10);
    const excerpt = (text: string) => (from > 0 ? "..." : "") + shorten(text.slice(from), 40);
    return [`${prefix}${excerpt(left)}`, `${prefix}${excerpt(right)}`];
  }
  return [`${prefix}${describeScalar(left)}`, `${prefix}${describeScalar(right)}`];
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

const LISTED_ITEMS = 4;

function listLabels(labels: ReadonlyArray<string>): string {
  const shown = labels.slice(0, LISTED_ITEMS).join(", ");
  return labels.length > LISTED_ITEMS ? `${shown} +${labels.length - LISTED_ITEMS} more` : shown;
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
    const differing = firstDifference(local[start], remote[start]);
    const order = (items: ReadonlyArray<unknown>, first: string | undefined) => {
      const labels = items.slice(start).map(syncedItemLabel);
      if (first !== undefined && labels[0] !== undefined) labels[0] = `${labels[0]} (${first})`;
      return `${countLabel(items.length, "item")}, from #${start + 1}: ${listLabels(labels)}`;
    };
    // Equal labels at the first differing position need the field that tells them apart.
    const tell = syncedItemLabel(local[start]) === syncedItemLabel(remote[start]);
    return {
      local: order(local, tell ? differing?.[0] : undefined),
      remote: order(remote, tell ? differing?.[1] : undefined),
    };
  }
  // An item edited in place shows on both sides under one label; name the field that changed.
  const remoteByLabel = new Map(remoteOnly.map((item) => [syncedItemLabel(item), item]));
  const localByLabel = new Map(localOnly.map((item) => [syncedItemLabel(item), item]));
  const side = (
    items: ReadonlyArray<unknown>,
    extra: ReadonlyArray<unknown>,
    counterpart: ReadonlyMap<string, unknown>,
    pick: 0 | 1,
  ) => {
    const count = countLabel(items.length, "item");
    if (extra.length === 0) return count;
    const labels = extra.map((item) => {
      const label = syncedItemLabel(item);
      if (!counterpart.has(label)) return label;
      const other = counterpart.get(label);
      const differing = pick === 0 ? firstDifference(item, other) : firstDifference(other, item);
      return differing ? `${label} (${differing[pick]})` : label;
    });
    return `${count}, incl. ${listLabels(labels)}`;
  };
  return {
    local: side(local, localOnly, remoteByLabel, 0),
    remote: side(remote, remoteOnly, localByLabel, 1),
  };
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
  if (isPlainRecord(local) && isPlainRecord(remote)) {
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
