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

export function draftRouteIdentity(draft: NewTaskDraftRouteParams): string {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return JSON.stringify([
    draft.requestId,
    first(draft.draftId),
    first(draft.environmentId),
    first(draft.projectId),
    draft.branch ?? null,
    draft.worktreePath ?? null,
    first(draft.incomingShareId),
  ]);
}

/** `{ madohomu: true }` when the nearest thread route was opened from MadoHomu. */
export function madohomuRouteFlag(
  state:
    | {
        readonly index: number;
        readonly routes: ReadonlyArray<{ readonly name: string; readonly params?: object }>;
      }
    | undefined,
): { readonly madohomu?: true } {
  const thread = state?.routes
    .slice(0, state.index + 1)
    .findLast((route) => route.name === "Thread");
  const params = thread?.params as { readonly madohomu?: unknown } | undefined;
  return params?.madohomu === true ? { madohomu: true } : {};
}
