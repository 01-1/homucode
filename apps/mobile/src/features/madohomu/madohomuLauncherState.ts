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

export function madohomuLauncherEnvironmentId(
  environments: ReadonlyArray<EnvironmentMadoHomuState>,
): string | undefined {
  return environments.find((environment) => environment.madohomuEnabled === true)?.environmentId;
}
