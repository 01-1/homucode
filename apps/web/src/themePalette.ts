import { THEME_CSS_MAX_LENGTH, type EnvironmentTheme } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";
import {
  BUILT_IN_THEMES,
  EMBER_THEME,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
  RESERVED_THEME_IDS,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeVariants,
} from "@t3tools/shared/themePalettes";
import {
  contextChipVariables,
  createVividThemeColors,
  decodeThemeColors,
  getDefaultThemeColors,
  getStandardThemeColors,
  lenientThemeColorOverrides,
  publishedThemeDefinitions,
  toCanonicalThemeColor,
} from "@t3tools/shared/themeColors";

export {
  contextChipAccentWithHueOf,
  contextChipVariables,
  createVividThemeColors,
  getDefaultThemeColors,
  getStandardThemeColors,
  readableThemeColorOn,
  themeColorToHex,
  toCanonicalThemeColor,
  updateThemeColorFamily,
} from "@t3tools/shared/themeColors";

import { m } from "./i18n/messages";
import { appAtomRegistry, subscribeAtomChanges } from "./rpc/atomRegistry";
import { applyThemeBackground } from "./themeBackground";
import { applyThemeCss } from "./themeCss";
import { themeServerEnvironmentThemesAtom } from "./state/server";

export { EMBER_THEME, GROVE_THEME, IRIS_THEME, OCEAN_THEME, T3_CHAT_THEME, THEME_COLOR_ROLES };
export type { ThemeAppearance, ThemeColorRole, ThemeColors, ThemeDefinition, ThemeVariants };

const T3_CHAT_THEME_ID = "t3-chat" as const;
const GROVE_THEME_ID = "grove" as const;
const OCEAN_THEME_ID = "ocean" as const;
const EMBER_THEME_ID = "ember" as const;
const IRIS_THEME_ID = "iris" as const;
export const THEME_FILE_VERSION = 1 as const;
export const THEME_STORAGE_KEY = "t3code:theme";
export const CUSTOM_THEMES_STORAGE_KEY = "t3code:themes:v1";
export const THEME_FOLLOW_SYSTEM_STORAGE_KEY = "t3code:theme-follow-system";
export const THEME_APPEARANCE_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";
export const THEME_HALVES_STORAGE_KEY = "t3code:theme-halves:v1";
export const ENVIRONMENT_THEMES_STORAGE_KEY = "t3code:environment-themes:v1";

const LEGACY_T3_CHAT_DARK_THEME_ID = "t3-chat-dark";

export const ThemePreference = Schema.String;
export type ThemePreference = typeof ThemePreference.Type;

const THEME_COLOR_ROLE_SET: ReadonlySet<string> = new Set(THEME_COLOR_ROLES);
export type ThemeColorOverrides = Readonly<Partial<Record<ThemeColorRole, string>>>;
export type ThemeVariantOverrides = Readonly<Partial<Record<ThemeAppearance, ThemeColorOverrides>>>;
export type ThemePreferenceMode = ThemeAppearance | "system";
export type ThemeCollection = Readonly<{ id: string; label: string }>;
export type ThemeFile = Readonly<{
  version: typeof THEME_FILE_VERSION;
  id: string;
  name: string;
  appearance: ThemeAppearance;
  colors: ThemeColorOverrides;
  variants?: ThemeVariantOverrides;
  collection?: ThemeCollection;
  managed?: boolean;
  css?: string;
}>;

const customThemeListeners = new Set<() => void>();
type CustomThemeLibrarySnapshot =
  | Readonly<{
      status: "ready";
      storedThemes: ReadonlyArray<unknown>;
      themes: ReadonlyArray<ThemeDefinition>;
    }>
  | Readonly<{ status: "unavailable"; reason: "malformed" }>
  | Readonly<{ status: "unavailable"; reason: "storage-unavailable"; cause: unknown }>;

let customThemeLibrarySnapshot: CustomThemeLibrarySnapshot | null = null;
const themePreviewListeners = new Set<() => void>();
let themePreviewAppearance: ThemeAppearance | null = null;

export function getThemePreviewAppearance(): ThemeAppearance | null {
  return themePreviewAppearance;
}

export function getThemePreviewSidebarArtwork(): boolean | null {
  return themePreviewAppearance === null ? null : false;
}

export function subscribeToThemePreview(listener: () => void): () => void {
  themePreviewListeners.add(listener);
  return () => themePreviewListeners.delete(listener);
}

function setThemePreviewAppearance(appearance: ThemeAppearance | null): void {
  if (themePreviewAppearance === appearance) return;
  themePreviewAppearance = appearance;
  for (const listener of themePreviewListeners) listener();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === "light" || value === "dark";
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && toCanonicalThemeColor(value) !== null;
}

function isThemeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,47})$/.test(value);
}

function isThemeLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 48;
}

function isThemeCss(value: unknown): value is string {
  return typeof value === "string" && value.length <= THEME_CSS_MAX_LENGTH;
}

function parseThemeCollection(value: unknown): ThemeCollection | undefined {
  return isRecord(value) &&
    typeof value.id === "string" &&
    /^[a-z0-9][a-z0-9.:-]{0,127}$/i.test(value.id) &&
    isThemeLabel(value.label)
    ? { id: value.id, label: value.label.trim() }
    : undefined;
}

function parseStoredThemeColors(value: unknown, appearance: ThemeAppearance): ThemeColors | null {
  if (!isRecord(value)) return null;
  return { ...getDefaultThemeColors(appearance), ...lenientThemeColorOverrides(value) };
}

function parseStoredThemeVariants(
  value: unknown,
  baseAppearance: ThemeAppearance,
): ThemeVariants | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {};
  for (const [appearance, colors] of Object.entries(value)) {
    if (!isThemeAppearance(appearance)) return null;
    // Base colors shadow a matching variant; drop it for parseThemeFile round-trips.
    if (appearance === baseAppearance) continue;
    const parsedColors = parseStoredThemeColors(colors, appearance);
    if (!parsedColors) return null;
    variants[appearance] = parsedColors;
  }
  return Object.keys(variants).length > 0 ? variants : undefined;
}

function parseStoredTheme(value: unknown): ThemeDefinition | null {
  if (!isRecord(value)) return null;
  if (!isThemeId(value.id) || RESERVED_THEME_IDS.has(value.id)) return null;
  if (!isThemeLabel(value.label) || !isThemeAppearance(value.appearance)) return null;
  const colors = parseStoredThemeColors(value.colors, value.appearance);
  if (!colors) return null;
  const variants = parseStoredThemeVariants(value.variants, value.appearance);
  if (value.variants !== undefined && variants === null) return null;
  const collection = parseThemeCollection(value.collection);

  return {
    id: value.id,
    label: value.label.trim(),
    appearance: value.appearance,
    colors,
    ...(variants ? { variants } : {}),
    ...(collection ? { collection } : {}),
    ...(value.managed === true ? { managed: true } : {}),
    ...(isThemeCss(value.css) && value.css.length > 0 ? { css: value.css } : {}),
  };
}

function parseStoredThemes(storedThemes: ReadonlyArray<unknown>): ReadonlyArray<ThemeDefinition> {
  const themes: ThemeDefinition[] = [];
  for (const value of storedThemes) {
    const theme = parseStoredTheme(value);
    if (theme && !themes.some((existing) => existing.id === theme.id)) {
      themes.push(theme);
    }
  }
  return themes;
}

function readCustomThemeLibrarySnapshot(): CustomThemeLibrarySnapshot {
  if (typeof window === "undefined") {
    return { status: "ready", storedThemes: [], themes: [] };
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
  } catch (cause) {
    return { status: "unavailable", reason: "storage-unavailable", cause };
  }
  if (!raw) return { status: "ready", storedThemes: [], themes: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unavailable", reason: "malformed" };
  }
  if (!Array.isArray(parsed)) return { status: "unavailable", reason: "malformed" };

  return { status: "ready", storedThemes: parsed, themes: parseStoredThemes(parsed) };
}

function getCustomThemeLibrarySnapshot(): CustomThemeLibrarySnapshot {
  if (customThemeLibrarySnapshot === null) {
    customThemeLibrarySnapshot = readCustomThemeLibrarySnapshot();
  }
  return customThemeLibrarySnapshot;
}

function notifyCustomThemeListeners() {
  for (const listener of customThemeListeners) listener();
}

export function invalidateCustomThemes() {
  customThemeLibrarySnapshot = null;
  notifyCustomThemeListeners();
}

const EMPTY_CUSTOM_THEMES: ReadonlyArray<ThemeDefinition> = [];

export function getCustomThemes(): ReadonlyArray<ThemeDefinition> {
  const snapshot = getCustomThemeLibrarySnapshot();
  return snapshot.status === "ready" ? snapshot.themes : EMPTY_CUSTOM_THEMES;
}

// Every reconnect snapshot delivers a fresh but usually identical array; keeping the
// previous one skips regenerating palettes and repainting the document for it.
const publishedThemesAtom = Atom.make((get): ReadonlyArray<EnvironmentTheme> | null => {
  const next = get(themeServerEnvironmentThemesAtom);
  const previous = Option.getOrNull(get.self<ReadonlyArray<EnvironmentTheme> | null>());
  return previous !== null && Equal.equals(previous, next) ? previous : next;
}).pipe(Atom.withLabel("web-published-environment-themes"));

function readStoredEnvironmentThemes(): ReadonlyArray<ThemeDefinition> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(ENVIRONMENT_THEMES_STORAGE_KEY) ?? "null",
    );
    return Array.isArray(parsed) ? parseStoredThemes(parsed) : [];
  } catch {
    return [];
  }
}

/**
 * Falls back to the last published set while the server connects, so boot and the
 * first render paint the selected palette. Kept alive because theme lookups read it
 * outside React on every repaint.
 */
export const environmentThemeDefinitionsAtom = Atom.make((get) => {
  const published = get(publishedThemesAtom);
  const definitions =
    published === null ? readStoredEnvironmentThemes() : publishedThemeDefinitions(published);
  const previous = Option.getOrNull(get.self<ReadonlyArray<ThemeDefinition>>());
  return previous !== null && Equal.equals(previous, definitions) ? previous : definitions;
}).pipe(Atom.keepAlive, Atom.withLabel("web-environment-theme-definitions"));

export function storePublishedEnvironmentThemes(definitions: ReadonlyArray<ThemeDefinition>) {
  if (appAtomRegistry.get(publishedThemesAtom) === null) return;
  try {
    window.localStorage.setItem(ENVIRONMENT_THEMES_STORAGE_KEY, JSON.stringify(definitions));
  } catch {
    // Without the stored copy the next launch paints stock colors until connect.
  }
}

function getEnvironmentThemes(): ReadonlyArray<ThemeDefinition> {
  return appAtomRegistry.get(environmentThemeDefinitionsAtom);
}

export function isReservedThemeId(themeId: string): boolean {
  return RESERVED_THEME_IDS.has(themeId);
}

export function getStoredCustomThemeCollection(
  collectionId: string,
): ReadonlyArray<ThemeDefinition> {
  return readWritableCustomThemeLibrary().themes.filter(
    (theme) => theme.collection?.id === collectionId,
  );
}

export function subscribeToCustomThemes(listener: () => void): () => void {
  customThemeListeners.add(listener);
  const unsubscribeEnvironment = subscribeAtomChanges(environmentThemeDefinitionsAtom, () =>
    listener(),
  );
  if (typeof window === "undefined") {
    return () => {
      customThemeListeners.delete(listener);
      unsubscribeEnvironment();
    };
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CUSTOM_THEMES_STORAGE_KEY || event.key === null) {
      invalidateCustomThemes();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    customThemeListeners.delete(listener);
    unsubscribeEnvironment();
    window.removeEventListener("storage", handleStorage);
  };
}

const LEGACY_THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  [LEGACY_T3_CHAT_DARK_THEME_ID]: T3_CHAT_THEME_ID,
  "t3-grove": GROVE_THEME_ID,
  "t3-ocean": OCEAN_THEME_ID,
  "t3-ember": EMBER_THEME_ID,
  "t3-iris": IRIS_THEME_ID,
};

function normalizeThemeId(themeId: string): string {
  return Object.hasOwn(LEGACY_THEME_ID_ALIASES, themeId)
    ? (LEGACY_THEME_ID_ALIASES[themeId] ?? themeId)
    : themeId;
}

export function canonicalThemePreference(theme: string): string {
  return theme === LEGACY_T3_CHAT_DARK_THEME_ID ? theme : normalizeThemeId(theme);
}

function themeIdFromPreference(theme: ThemePreference): string {
  return normalizeThemeId(theme);
}

function legacyThemeMode(theme: ThemePreference): ThemeAppearance | null {
  return theme === LEGACY_T3_CHAT_DARK_THEME_ID ? "dark" : null;
}

// index.css paints the light bubble a step darker than the shared palette mobile uses.
const STANDARD_WEB_PAINTED_COLORS: Record<ThemeAppearance, Partial<ThemeColors>> = {
  light: { messageSurface: "#ebebed" },
  dark: { canvas: "#000000", messageSurface: "#1e1e1e" },
};

/** The standard theme as index.css paints it, for solves that measure the page. */
export function getStandardPaintedThemeColors(appearance: ThemeAppearance): ThemeColors {
  return { ...getStandardThemeColors(appearance), ...STANDARD_WEB_PAINTED_COLORS[appearance] };
}

function canonicalizeThemeDefinition(theme: ThemeDefinition): ThemeDefinition {
  return {
    ...theme,
    colors: decodeThemeColors(theme.colors),
    ...(theme.variants
      ? {
          variants: Object.fromEntries(
            Object.entries(theme.variants).map(([appearance, colors]) => [
              appearance,
              decodeThemeColors(colors),
            ]),
          ) as ThemeVariants,
        }
      : {}),
  };
}

function applyContextChipVariables(root: HTMLElement, colors: ThemeColors): void {
  const variables = contextChipVariables(colors);
  root.style.removeProperty("--context-chip-message");
  root.style.removeProperty("--context-chip-invalid");
  for (const [variable, value] of Object.entries(variables)) {
    root.style.setProperty(variable, value);
  }
}

const BUILT_IN_THEME_DEFINITIONS: ReadonlyArray<ThemeDefinition> = BUILT_IN_THEMES;

export function getThemeDefinition(theme: ThemePreference): ThemeDefinition | null {
  const themeId = themeIdFromPreference(theme);
  return (
    BUILT_IN_THEME_DEFINITIONS.find((definition) => definition.id === themeId) ??
    getCustomThemes().find((definition) => definition.id === themeId) ??
    getEnvironmentThemes().find((definition) => definition.id === themeId) ??
    null
  );
}

export function themeAllowsSidebarArtwork(theme: ThemePreference): boolean {
  const themeId = themeIdFromPreference(theme);
  return (
    BUILT_IN_THEME_DEFINITIONS.find((definition) => definition.id === themeId)?.sidebarArtwork ===
    true
  );
}

/** Every selection path must check single-appearance themes to keep mix and appearance tiles in sync. */
export function singleAppearanceOf(theme: ThemeDefinition): ThemeAppearance | null {
  const modes = getThemeModes(theme);
  return modes.length === 1 ? modes[0]! : null;
}

export function getThemeColorsForMode(
  theme: ThemeDefinition,
  mode: ThemeAppearance,
): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors;
  return theme.variants?.[mode] ?? null;
}

export function getThemeModes(theme: ThemeDefinition): ReadonlyArray<ThemeAppearance> {
  return (["light", "dark"] as const).filter((mode) => getThemeColorsForMode(theme, mode) !== null);
}

export function getThemePreferenceMode(theme: ThemePreference): ThemeAppearance | null {
  if (theme === "system") return null;
  if (theme === "light" || theme === "dark") return theme;
  const legacyMode = legacyThemeMode(theme);
  if (legacyMode) return legacyMode;
  return getThemeDefinition(theme)?.appearance ?? null;
}

export function themeIdFromName(name: string): string {
  const label = name.trim().toLowerCase();
  const normalized = label
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (normalized || !label) return normalized || "custom-theme";

  // Names without ASCII letters or digits still need independent, stable ids.
  let hash = 2_166_136_261;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `theme-${(hash >>> 0).toString(36)}`;
}

export class ThemeLibraryStorageError extends Schema.TaggedError<ThemeLibraryStorageError>()(
  "ThemeLibraryStorageError",
  {
    storageKey: Schema.String,
    operation: Schema.Literals(["read", "write"]),
    reason: Schema.Literals(["malformed", "storage-unavailable"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.operation === "read"
      ? m(
          msg("Failed to read the theme library from {storageKey}.", {
            storageKey: this.storageKey,
          }),
        )
      : m(
          msg("Failed to write the theme library to {storageKey}.", {
            storageKey: this.storageKey,
          }),
        );
  }
}

function saveCustomThemes(
  storedThemes: ReadonlyArray<unknown>,
  themes: ReadonlyArray<ThemeDefinition>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(storedThemes));
    customThemeLibrarySnapshot = { status: "ready", storedThemes, themes };
  } catch (cause) {
    throw new ThemeLibraryStorageError({
      storageKey: CUSTOM_THEMES_STORAGE_KEY,
      operation: "write",
      reason: "storage-unavailable",
      cause,
    });
  }
  notifyCustomThemeListeners();
}

function requireWritableCustomThemeLibrary(
  snapshot: CustomThemeLibrarySnapshot,
): Extract<CustomThemeLibrarySnapshot, { status: "ready" }> {
  if (snapshot.status === "unavailable") {
    throw new ThemeLibraryStorageError({
      storageKey: CUSTOM_THEMES_STORAGE_KEY,
      operation: "read",
      reason: snapshot.reason,
      ...("cause" in snapshot ? { cause: snapshot.cause } : {}),
    });
  }
  return snapshot;
}

function getWritableCustomThemeLibrary(): Extract<CustomThemeLibrarySnapshot, { status: "ready" }> {
  return requireWritableCustomThemeLibrary(getCustomThemeLibrarySnapshot());
}

function readWritableCustomThemeLibrary(): Extract<
  CustomThemeLibrarySnapshot,
  { status: "ready" }
> {
  return requireWritableCustomThemeLibrary(readCustomThemeLibrarySnapshot());
}

function storedThemeHasId(storedTheme: unknown, themeId: string): boolean {
  return isRecord(storedTheme) && storedTheme.id === themeId;
}

function storedThemeHasCollectionId(storedTheme: unknown, collectionId: string): boolean {
  return (
    isRecord(storedTheme) &&
    isRecord(storedTheme.collection) &&
    storedTheme.collection.id === collectionId
  );
}

export function installCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  if (RESERVED_THEME_IDS.has(theme.id)) {
    throw new Error(m(msg('The theme id "{id}" is reserved.', { id: theme.id })));
  }
  const library = getWritableCustomThemeLibrary();
  if (
    BUILT_IN_THEME_DEFINITIONS.some((existing) => existing.id === theme.id) ||
    library.storedThemes.some((storedTheme) => storedThemeHasId(storedTheme, theme.id))
  ) {
    throw new Error(
      m(msg('A theme named "{label}" is already installed.', { label: theme.label })),
    );
  }
  const canonicalTheme = canonicalizeThemeDefinition(theme);
  const themes = [...library.themes, canonicalTheme];
  saveCustomThemes([...library.storedThemes, canonicalTheme], themes);
  return canonicalTheme;
}

export function updateCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  if (RESERVED_THEME_IDS.has(theme.id)) {
    throw new Error(m(msg('The theme id "{id}" is reserved.', { id: theme.id })));
  }

  const library = getWritableCustomThemeLibrary();
  const themes = library.themes;
  const themeIndex = themes.findIndex((existing) => existing.id === theme.id);
  if (themeIndex === -1) {
    throw new Error(m(msg('The theme "{label}" is not installed.', { label: theme.label })));
  }

  const canonicalTheme = canonicalizeThemeDefinition(theme);
  const nextThemes = [...themes];
  nextThemes[themeIndex] = canonicalTheme;

  const nextStoredThemes: unknown[] = [];
  let replaced = false;
  for (const storedTheme of library.storedThemes) {
    if (!storedThemeHasId(storedTheme, theme.id)) {
      nextStoredThemes.push(storedTheme);
    } else if (!replaced) {
      nextStoredThemes.push(canonicalTheme);
      replaced = true;
    }
  }
  saveCustomThemes(nextStoredThemes, nextThemes);
  return canonicalTheme;
}

export function replaceCustomThemeCollection(
  collectionId: string,
  themes: ReadonlyArray<ThemeDefinition>,
  options?: { expectedCollection?: ReadonlyArray<ThemeDefinition> },
): ReadonlyArray<ThemeDefinition> {
  if (themes.length === 0) throw new Error(m(msg("A theme collection cannot be empty.")));

  const validated = themes.map((theme) => parseStoredTheme(theme));
  if (
    validated.some((theme) => theme === null || theme.collection?.id !== collectionId) ||
    new Set(validated.map((theme) => theme?.id)).size !== validated.length
  ) {
    throw new Error(m(msg("That theme collection is invalid.")));
  }
  const replacement = validated as ThemeDefinition[];
  const library = readWritableCustomThemeLibrary();
  const current = library.themes;
  const currentCollection = current.filter((theme) => theme.collection?.id === collectionId);
  if (
    options?.expectedCollection &&
    JSON.stringify(currentCollection) !== JSON.stringify(options.expectedCollection)
  ) {
    throw new Error(
      m(msg("Your installed themes changed while this package was downloading. Try again.")),
    );
  }
  const occupiedIds = new Set(BUILT_IN_THEME_DEFINITIONS.map((theme) => theme.id));
  for (const storedTheme of library.storedThemes) {
    if (
      !storedThemeHasCollectionId(storedTheme, collectionId) &&
      isRecord(storedTheme) &&
      typeof storedTheme.id === "string"
    ) {
      occupiedIds.add(storedTheme.id);
    }
  }
  const conflictingTheme = replacement.find(
    (theme) => RESERVED_THEME_IDS.has(theme.id) || occupiedIds.has(theme.id),
  );
  if (conflictingTheme) {
    throw new Error(
      m(msg('A theme named "{label}" is already installed.', { label: conflictingTheme.label })),
    );
  }

  const nextStoredThemes: unknown[] = [];
  let insertedReplacement = false;
  for (const storedTheme of library.storedThemes) {
    if (!storedThemeHasCollectionId(storedTheme, collectionId)) {
      nextStoredThemes.push(storedTheme);
    } else if (!insertedReplacement) {
      nextStoredThemes.push(...replacement);
      insertedReplacement = true;
    }
  }
  if (!insertedReplacement) nextStoredThemes.push(...replacement);

  saveCustomThemes(nextStoredThemes, parseStoredThemes(nextStoredThemes));
  return replacement;
}

export function removeCustomTheme(themeId: string): void {
  removeCustomThemes([themeId]);
}

export function removeCustomThemes(themeIds: ReadonlyArray<string>): void {
  const removedIds = new Set(themeIds);
  if (removedIds.size === 0) return;
  const library = getWritableCustomThemeLibrary();
  const nextThemes = library.themes.filter((theme) => !removedIds.has(theme.id));
  if (nextThemes.length === library.themes.length) return;
  saveCustomThemes(
    library.storedThemes.filter(
      (storedTheme) =>
        !isRecord(storedTheme) ||
        typeof storedTheme.id !== "string" ||
        !removedIds.has(storedTheme.id),
    ),
    nextThemes,
  );
}

function parseThemeColorOverrides(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) throw new Error(m(msg("Theme colors must be objects.")));

  const overrides: Partial<Record<ThemeColorRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (!THEME_COLOR_ROLE_SET.has(role)) {
      throw new Error(m(msg('"{role}" is not a supported theme color role.', { role })));
    }
    const normalized = toCanonicalThemeColor(color);
    if (!normalized) {
      throw new Error(
        m(
          msg('The color for "{role}" must be a literal CSS color such as oklch(0.62 0.2 280).', {
            role,
          }),
        ),
      );
    }
    overrides[role as ThemeColorRole] = normalized;
  }
  if (Object.keys(overrides).length === 0) {
    throw new Error(m(msg("Add at least one color role to the theme file.")));
  }
  return overrides;
}

function parseThemeSeedColor(name: string, value: unknown): string {
  if (typeof value !== "string" || !toCanonicalThemeColor(value)) {
    throw new Error(m(msg("The theme''s \"{name}\" must be a literal CSS color.", { name })));
  }
  return value;
}

export function parseThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) {
    throw new Error(m(msg("Theme files must contain a JSON object.")));
  }
  if (value.version !== THEME_FILE_VERSION) {
    throw new Error(
      m(
        msg("This theme file uses an unsupported version. Expected {version}.", {
          version: THEME_FILE_VERSION,
        }),
      ),
    );
  }

  const name = value.name;
  const appearance = value.appearance;
  const rawColors = value.colors;
  if (!isThemeLabel(name))
    throw new Error(m(msg("Theme files need a name (48 characters or fewer).")));
  if (!isThemeAppearance(appearance)) {
    throw new Error(m(msg('Theme files need an appearance of "light" or "dark".')));
  }
  if (!isRecord(rawColors)) throw new Error(m(msg("Theme files need a colors object.")));

  const id = value.id === undefined ? themeIdFromName(name) : value.id;
  if (!isThemeId(id)) {
    throw new Error(m(msg("Theme ids may only contain lowercase letters, numbers, and hyphens.")));
  }
  if (RESERVED_THEME_IDS.has(id)) {
    throw new Error(m(msg('The theme id "{id}" is reserved.', { id })));
  }

  const overrides = parseThemeColorOverrides(rawColors);
  const collection = parseThemeCollection(value.collection);
  if (value.collection !== undefined && !collection) {
    throw new Error(m(msg("Theme collections need a valid id and label.")));
  }

  if (value.css !== undefined && !isThemeCss(value.css)) {
    throw new Error(
      m(msg("Theme CSS must be text of {max} characters or fewer.", { max: THEME_CSS_MAX_LENGTH })),
    );
  }

  const fallback =
    value.canvas !== undefined && value.accent !== undefined
      ? createVividThemeColors(
          appearance,
          parseThemeSeedColor("canvas", value.canvas),
          parseThemeSeedColor("accent", value.accent),
        )
      : getDefaultThemeColors(appearance);
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {};
  if (value.variants !== undefined) {
    if (!isRecord(value.variants)) throw new Error(m(msg("Theme variants must be an object.")));
    for (const [variantAppearance, variantColors] of Object.entries(value.variants)) {
      if (!isThemeAppearance(variantAppearance)) {
        throw new Error(m(msg('Theme variants may only be named "light" or "dark".')));
      }
      if (variantAppearance === appearance) {
        throw new Error(
          m(
            msg('Theme variants must not repeat the base appearance "{appearance}".', {
              appearance,
            }),
          ),
        );
      }
      const variantFallback = getDefaultThemeColors(variantAppearance);
      variants[variantAppearance] = {
        ...variantFallback,
        ...parseThemeColorOverrides(variantColors),
      };
    }
  }

  return {
    id,
    label: name.trim(),
    appearance,
    colors: { ...fallback, ...overrides },
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
    ...(collection ? { collection } : {}),
    ...(value.managed === true ? { managed: true } : {}),
    ...(value.css ? { css: value.css } : {}),
  };
}

/** A copy of `theme` under `name` and the id it derives. The collection stays behind. */
export function renameTheme(theme: ThemeDefinition, name: string): ThemeDefinition {
  return parseThemeFile({
    version: THEME_FILE_VERSION,
    name,
    appearance: theme.appearance,
    colors: theme.colors,
    ...(theme.variants ? { variants: theme.variants } : {}),
    ...(theme.managed ? { managed: true } : {}),
    ...(theme.css ? { css: theme.css } : {}),
  });
}

export function serializeThemeFile(theme: ThemeDefinition): string {
  const canonicalTheme = canonicalizeThemeDefinition(theme);
  const file: ThemeFile = {
    version: THEME_FILE_VERSION,
    id: canonicalTheme.id,
    name: canonicalTheme.label,
    appearance: canonicalTheme.appearance,
    colors: canonicalTheme.colors,
    ...(canonicalTheme.variants ? { variants: canonicalTheme.variants } : {}),
    ...(canonicalTheme.collection ? { collection: canonicalTheme.collection } : {}),
    ...(canonicalTheme.managed ? { managed: true } : {}),
    ...(canonicalTheme.css ? { css: canonicalTheme.css } : {}),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
  canvas: "--app-theme-canvas",
  chrome: "--app-theme-chrome",
  toolbar: "--app-theme-toolbar",
  toolbarForeground: "--app-theme-toolbar-foreground",
  toolbarBorder: "--app-theme-toolbar-border",
  toolbarControl: "--app-theme-toolbar-control",
  toolbarControlForeground: "--app-theme-toolbar-control-foreground",
  toolbarControlHover: "--app-theme-toolbar-control-hover",
  surface: "--app-theme-surface",
  surfaceRaised: "--app-theme-surface-raised",
  surfaceOverlay: "--app-theme-surface-overlay",
  text: "--app-theme-text",
  textMuted: "--app-theme-text-muted",
  border: "--app-theme-border",
  input: "--app-theme-input",
  focus: "--app-theme-focus",
  accent: "--app-theme-accent",
  accentForeground: "--app-theme-accent-foreground",
  secondary: "--app-theme-secondary",
  secondaryForeground: "--app-theme-secondary-foreground",
  muted: "--app-theme-muted",
  mutedForeground: "--app-theme-muted-foreground",
  placeholder: "--app-theme-placeholder",
  secondaryLabel: "--app-theme-secondary-label",
  iconMuted: "--app-theme-icon-muted",
  error: "--app-theme-error",
  errorForeground: "--app-theme-error-foreground",
  errorSurface: "--app-theme-error-surface",
  warning: "--app-theme-warning",
  warningForeground: "--app-theme-warning-foreground",
  warningSurface: "--app-theme-warning-surface",
  update: "--app-theme-update",
  updateForeground: "--app-theme-update-foreground",
  updateSurface: "--app-theme-update-surface",
  accentSurface: "--app-theme-accent-surface",
  accentSurfaceForeground: "--app-theme-accent-surface-foreground",
  messageSurface: "--app-theme-message-surface",
  messageForeground: "--app-theme-message-foreground",
  messageAction: "--app-theme-message-action",
  messageActionForeground: "--app-theme-message-action-foreground",
  messageActionHover: "--app-theme-message-action-hover",
  codeBackground: "--app-theme-code-background",
  codeForeground: "--app-theme-code-foreground",
  searchMatchBackground: "--app-theme-search-match-background",
  searchMatchForeground: "--app-theme-search-match-foreground",
  searchMatchActiveBackground: "--app-theme-search-match-active-background",
  searchMatchActiveForeground: "--app-theme-search-match-active-foreground",
  sidebar: "--app-theme-sidebar",
  sidebarForeground: "--app-theme-sidebar-foreground",
  sidebarMutedForeground: "--app-theme-sidebar-muted-foreground",
  sidebarControlSurface: "--app-theme-sidebar-control-surface",
  sidebarRowHover: "--app-theme-sidebar-row-hover",
  sidebarRowActive: "--app-theme-sidebar-row-active",
  sidebarRowSelected: "--app-theme-sidebar-row-selected",
  sidebarBorder: "--app-theme-sidebar-border",
  terminalBackground: "--app-theme-terminal-background",
  terminalForeground: "--app-theme-terminal-foreground",
  terminalCursor: "--app-theme-terminal-cursor",
  terminalSelection: "--app-theme-terminal-selection-background",
  terminalScrollbar: "--app-theme-terminal-scrollbar",
  terminalScrollbarHover: "--app-theme-terminal-scrollbar-hover",
};

export function getThemeColorVariable(role: ThemeColorRole): string {
  return APP_THEME_VARIABLES[role];
}

export const THEME_PREVIEW_ID = "__preview";

/** Callers must restore the stored theme with refreshTheme when the draft closes. */
export function applyThemeColorPreview(
  colors: ThemeColors,
  appearance: ThemeAppearance,
  css?: string,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root?.style) return;

  root.dataset.themeId = THEME_PREVIEW_ID;
  root.classList.toggle("dark", appearance === "dark");
  for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
    if (isThemeColor(value)) root.style.setProperty(APP_THEME_VARIABLES[role], value);
  }
  applyContextChipVariables(root, colors);
  applyThemeCss(css);
  setThemePreviewAppearance(appearance);
}

export function applyThemePalette(theme: ThemePreference, appearance?: ThemeAppearance): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (!root?.style) return;

  setThemePreviewAppearance(null);
  const palette = getThemeDefinition(theme);
  applyThemeCss(palette?.css);
  applyThemeBackground(palette?.id);

  if (palette) {
    root.dataset.themeId = palette.id;
    const mode = appearance ?? legacyThemeMode(theme) ?? palette.appearance;
    const colors = getThemeColorsForMode(palette, mode) ?? palette.colors;
    for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
      root.style.setProperty(APP_THEME_VARIABLES[role], value);
    }
    applyContextChipVariables(root, colors);
    return;
  }

  delete root.dataset.themeId;
  for (const variable of Object.values(APP_THEME_VARIABLES)) {
    root.style.removeProperty(variable);
  }
  applyContextChipVariables(root, getStandardPaintedThemeColors(appearance ?? "light"));
}

export function resolveThemeAppearance(
  theme: ThemePreference,
  systemDark: boolean,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
  halves?: ThemeHalves | null,
): "light" | "dark" {
  const systemAppearance = systemDark ? "dark" : "light";
  const mode = appearanceMode ?? ((followSystem ?? theme === "system") ? "system" : null);
  if (mode === "system") {
    if (halves?.[systemAppearance]) return systemAppearance;
    const definition = getThemeDefinition(theme);
    return definition && getThemeColorsForMode(definition, systemAppearance) === null
      ? definition.appearance
      : systemAppearance;
  }
  if (mode === "light" || mode === "dark") {
    if (halves?.[mode]) return mode;
    const definition = getThemeDefinition(theme);
    return definition && getThemeColorsForMode(definition, mode) === null
      ? definition.appearance
      : mode;
  }
  return getThemePreferenceMode(theme) ?? "light";
}

export function resolveDesktopTheme(
  theme: ThemePreference,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
  halves?: ThemeHalves | null,
): "light" | "dark" | "system" {
  const mode = appearanceMode ?? ((followSystem ?? theme === "system") ? "system" : null);
  if (mode === "system") {
    const definition = getThemeDefinition(theme);
    const hasLightMode =
      halves?.light !== undefined ||
      (definition !== null && getThemeColorsForMode(definition, "light") !== null);
    const hasDarkMode =
      halves?.dark !== undefined ||
      (definition !== null && getThemeColorsForMode(definition, "dark") !== null);
    return definition && (!hasLightMode || !hasDarkMode) ? definition.appearance : "system";
  }
  if (mode === "light" || mode === "dark") {
    if (halves?.[mode]) return mode;
    const definition = getThemeDefinition(theme);
    return definition && getThemeColorsForMode(definition, mode) === null
      ? definition.appearance
      : mode;
  }
  return getThemePreferenceMode(theme) ?? "system";
}

export function isKnownThemePreference(theme: string): boolean {
  if (theme === "light" || theme === "dark" || theme === "system") return true;
  return getThemeDefinition(theme) !== null;
}

export type ThemeHalves = Readonly<{ light?: string; dark?: string }>;

export function parseThemeHalves(raw: string | null): ThemeHalves | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const halves: { light?: string; dark?: string } = {};
    for (const appearance of ["light", "dark"] as const) {
      const themeId = value[appearance];
      if (typeof themeId !== "string") continue;
      const definition = getThemeDefinition(themeId);
      if (definition && getThemeColorsForMode(definition, appearance) !== null) {
        halves[appearance] = definition.id;
      }
    }
    return halves.light !== undefined || halves.dark !== undefined ? halves : null;
  } catch {
    return null;
  }
}

export function resolveThemeHalf(
  theme: ThemePreference,
  halves: ThemeHalves | null,
  appearance: ThemeAppearance,
): ThemePreference {
  return halves?.[appearance] ?? theme;
}
