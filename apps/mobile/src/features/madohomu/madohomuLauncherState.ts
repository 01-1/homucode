/** `launchSurface` the MadoHomu launcher activity passes to its React root. */
export const MADOHOMU_LAUNCH_SURFACE = "madohomu";

export interface EnvironmentMadoHomuState {
  readonly environmentId: string;
  readonly madohomuEnabled: boolean | undefined;
}

/**
 * Whether the MadoHomu launcher icon should exist: true once any environment has MadoHomu on,
 * false only when every environment's settings have loaded with it off. Undefined means not known
 * yet; the icon is left as it is then, because disabling it removes it from the home screen.
 */
export function madohomuLauncherWanted(
  environments: ReadonlyArray<EnvironmentMadoHomuState>,
): boolean | undefined {
  if (environments.some((environment) => environment.madohomuEnabled === true)) return true;
  if (environments.length === 0) return undefined;
  return environments.every((environment) => environment.madohomuEnabled === false)
    ? false
    : undefined;
}

/** The environment the MadoHomu launcher opens: the first one with MadoHomu on. */
export function madohomuLauncherEnvironmentId(
  environments: ReadonlyArray<EnvironmentMadoHomuState>,
): string | undefined {
  return environments.find((environment) => environment.madohomuEnabled === true)?.environmentId;
}

