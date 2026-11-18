import type { NavigationState } from "@react-navigation/native";

/** `launchSurface` the MadoHomu launcher activity passes to its React root. */
export const MADOHOMU_LAUNCH_SURFACE = "madohomu";

export interface EnvironmentMadoHomuState {
  readonly environmentId: string;
  readonly madohomuEnabled: boolean | undefined;
}

// Undefined (not known yet) leaves the icon alone: disabling it drops it from the home screen.
export function madohomuLauncherWanted(
  environments: ReadonlyArray<EnvironmentMadoHomuState>,
  catalogReady: boolean,
): boolean | undefined {
  if (environments.some((environment) => environment.madohomuEnabled === true)) return true;
  if (environments.length === 0) return catalogReady ? false : undefined;
  return environments.every((environment) => environment.madohomuEnabled === false)
    ? false
    : undefined;
}

/** Retargets the launcher workspace while preserving any open settings, chat or draft routes. */
export function madohomuLauncherDestinationAction(
  state: Pick<NavigationState, "key" | "routes"> | undefined,
  environmentId: string,
) {
  const root = state?.routes[0];
  const params = root?.params as { readonly environmentId?: string } | undefined;
  if (!state || root?.name !== "MadoHomu" || params?.environmentId === environmentId) return;
  return {
    type: "SET_PARAMS" as const,
    source: root.key,
    target: state.key,
    payload: { params: { environmentId } },
  };
}
