import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { environmentCatalog } from "~/connection/catalog";
import { serverEnvironment } from "~/state/server";

/** Each connected environment's server settings, for hiding MadoHomu threads from T3 Code lists. */
export const madohomuCodeVisibilitySettingsAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, ServerSettings> =>
    new Map(
      [...get(environmentCatalog.catalogValueAtom).entries.keys()].flatMap((environmentId) => {
        const settings = get(serverEnvironment.settingsValueAtom(environmentId));
        return settings === null ? [] : [[environmentId, settings] as const];
      }),
    ),
).pipe(Atom.withLabel("web-madohomu-code-visibility-settings"));
