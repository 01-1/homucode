import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { publishedThemeDefinitions } from "@t3tools/shared/themeColors";
import type { EnvironmentTheme } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { MOBILE_THEME_IDS } from "../lib/mobileTheme";
import { serverEnvironment } from "./server";

const EMPTY_THEMES: ReadonlyArray<EnvironmentTheme> = [];

// Keep the first enabled machine as the source even while it is offline.
export const mobileThemeSourceAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const environmentId = enabledEnvironmentIds(catalog).next().value;
  if (environmentId === undefined) return null;
  const config = get(serverEnvironment.configValueAtom(environmentId));
  return {
    environmentId,
    label: catalog.entries.get(environmentId)!.target.label,
    themes: config?.environmentThemes ?? EMPTY_THEMES,
    defaultTheme: config?.settings.defaultTheme ?? "",
    defaultThemeSetAt: config?.settings.defaultThemeSetAt ?? "",
  };
}).pipe(Atom.withEquality(Equal.equals));

const publishedThemesAtom = Atom.make(
  (get) => get(mobileThemeSourceAtom)?.themes ?? EMPTY_THEMES,
).pipe(Atom.withEquality(Equal.equals));

export const mobilePublishedThemesAtom = Atom.make((get) =>
  publishedThemeDefinitions(get(publishedThemesAtom)).filter(
    (theme) => !(MOBILE_THEME_IDS as readonly string[]).includes(theme.id),
  ),
);
