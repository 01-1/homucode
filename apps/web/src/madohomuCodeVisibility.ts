import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { environmentCatalog } from "~/connection/catalog";
import { serverEnvironment } from "~/state/server";

/** Linked environments' settings for resolving MadoHomu visibility in Code. */
export const madohomuCodeVisibilitySettingsAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, ServerSettings> =>
    new Map(
      [...enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom))].flatMap(
        (environmentId) => {
          const settings = get(serverEnvironment.settingsValueAtom(environmentId));
          return settings === null ? [] : [[environmentId, settings] as const];
        },
      ),
    ),
).pipe(Atom.withLabel("web-madohomu-code-visibility-settings"));
