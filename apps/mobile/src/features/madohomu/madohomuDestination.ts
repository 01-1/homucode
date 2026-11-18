import type { EnvironmentId, ScopedProjectRef, ServerSettingsPatch } from "@t3tools/contracts";

interface MadoHomuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly settings: {
    readonly madohomuEnabled: boolean;
    readonly madohomuDestinationEnvironmentId?: EnvironmentId | null;
  } | null;
}

interface MadoHomuDestination {
  readonly anchorEnvironmentId: EnvironmentId | null;
  readonly environmentId: EnvironmentId | null;
}

export function resolveMadoHomuDestination(
  environments: readonly MadoHomuEnvironment[],
  primaryEnvironmentId: EnvironmentId | null,
): MadoHomuDestination {
  const anchors = environments.filter(
    (environment) => environment.settings?.madohomuDestinationEnvironmentId != null,
  );
  // Mobile normally has no primary connection. Use a stable order when multiple linked
  // clients have already recorded a destination.
  const anchor =
    anchors.find((environment) => environment.environmentId === primaryEnvironmentId) ??
    anchors.reduce<MadoHomuEnvironment | undefined>(
      (first, environment) =>
        !first || environment.environmentId < first.environmentId ? environment : first,
      undefined,
    );
  return {
    anchorEnvironmentId: anchor?.environmentId ?? primaryEnvironmentId,
    environmentId: anchor?.settings?.madohomuDestinationEnvironmentId ?? null,
  };
}

export function madoHomuEntryEnvironments(
  environments: readonly MadoHomuEnvironment[],
  primaryEnvironmentId: EnvironmentId | null,
): readonly EnvironmentId[] {
  const { environmentId } = resolveMadoHomuDestination(environments, primaryEnvironmentId);
  const selected = environments.find((environment) => environment.environmentId === environmentId);
  if (selected) {
    return selected.settings?.madohomuEnabled === false ? [] : [selected.environmentId];
  }
  return environments
    .filter((environment) => environment.settings?.madohomuEnabled)
    .map((environment) => environment.environmentId);
}

export function madoHomuProjectAnchor(
  destination: MadoHomuDestination,
  openedEnvironmentId: EnvironmentId,
  projectEnvironmentId: EnvironmentId,
): EnvironmentId | null {
  return destination.environmentId === projectEnvironmentId
    ? null
    : (destination.anchorEnvironmentId ?? openedEnvironmentId);
}

export async function saveMadoHomuProject(
  destination: MadoHomuDestination,
  openedEnvironmentId: EnvironmentId,
  project: ScopedProjectRef,
  save: (environmentId: EnvironmentId, patch: ServerSettingsPatch) => Promise<boolean>,
): Promise<boolean> {
  const { environmentId, projectId } = project;
  const anchor = madoHomuProjectAnchor(destination, openedEnvironmentId, environmentId);
  const hostPatch = { madohomuEnabled: true, madohomuProjectId: projectId };
  if (anchor === environmentId) {
    return save(environmentId, { ...hostPatch, madohomuDestinationEnvironmentId: environmentId });
  }
  if (!(await save(environmentId, hostPatch))) return false;
  return anchor === null || save(anchor, { madohomuDestinationEnvironmentId: environmentId });
}
