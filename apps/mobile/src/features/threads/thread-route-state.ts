import { EnvironmentId, ProjectId } from "@t3tools/contracts";

export type NewTaskDraftRouteParams = {
  readonly requestId?: string;
  readonly environmentId?: string | string[];
  readonly projectId?: string | string[];
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly title?: string | string[];
  readonly cloning?: string | string[];
  readonly draftId?: string | string[];
  readonly incomingShareId?: string | string[];
  /** Started from a MadoHomu row: the new thread is pinned in MadoHomu. */
  readonly madohomu?: boolean;
};

export function isDraftThreadRoute(
  route:
    | {
        readonly name: string;
        readonly params?: object;
      }
    | undefined,
) {
  return (
    route?.name === "Thread" && Boolean((route.params as { draft?: unknown } | undefined)?.draft)
  );
}

export function submittedThreadParams(environmentId: string, threadId: string) {
  return { draft: undefined, environmentId, threadId };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function madohomuDraftRouteOrigin(draft: NewTaskDraftRouteParams | undefined) {
  if (draft?.madohomu !== true) return undefined;
  const environmentId = first(draft.environmentId);
  const projectId = first(draft.projectId);
  return environmentId && projectId
    ? { environmentId: EnvironmentId.make(environmentId), projectId: ProjectId.make(projectId) }
    : undefined;
}

export function draftRouteIdentity(draft: NewTaskDraftRouteParams): string {
  return JSON.stringify([
    draft.requestId,
    first(draft.draftId),
    first(draft.environmentId),
    first(draft.projectId),
    draft.branch ?? null,
    draft.worktreePath ?? null,
    first(draft.incomingShareId),
    draft.madohomu === true,
  ]);
}

export type MadoHomuThreadRouteParams = {
  readonly madohomu?: boolean;
  /** Resolve a link's project membership once its thread loads. */
  readonly madohomuLinkProjectId?: ProjectId;
};

export function isMadoHomuThreadRoute(
  params: MadoHomuThreadRouteParams,
  projectId?: ProjectId,
): boolean {
  return (
    params.madohomu === true ||
    (projectId !== undefined && projectId === params.madohomuLinkProjectId)
  );
}
