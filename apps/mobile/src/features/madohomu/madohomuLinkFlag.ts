import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells, environmentThreads } from "../../state/threads";
import { madohomuRouteFlag } from "../threads/thread-route-state";

function loadedProjectId(environmentId: EnvironmentId, threadId: ThreadId): ProjectId | undefined {
  const atom = environmentThreads.stateAtom(environmentId, threadId);
  if (!appAtomRegistry.getNodes().has(atom)) return undefined;
  return AsyncResult.value(appAtomRegistry.get(atom)).pipe(
    Option.flatMap((state) => state.data),
    Option.map((projection) => projection.thread.projectId),
    Option.getOrUndefined,
  );
}

/**
 * `{ madohomu: true }` for a thread opened from a MadoHomu thread screen when the target is in
 * MadoHomu's project, so it opens without the project subtitle. Other targets open as usual.
 */
export function madohomuLinkFlag(
  state: Parameters<typeof madohomuRouteFlag>[0],
  target: { readonly environmentId: string; readonly threadId: string },
  localParentProjectId?: ProjectId,
): { readonly madohomu?: true } {
  if (madohomuRouteFlag(state).madohomu !== true) return {};
  const source = state?.routes
    .slice(0, state.index + 1)
    .findLast((route) => route.name === "Thread")?.params as
    | { readonly environmentId?: unknown }
    | undefined;
  // MadoHomu is one project in one environment.
  if (source?.environmentId !== target.environmentId) return {};
  const environmentId = EnvironmentId.make(target.environmentId);
  const settings = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.settings;
  if (settings?.madohomuEnabled !== true || settings.madohomuProjectId === null) return {};
  const threadId = ThreadId.make(target.threadId);
  const shell = appAtomRegistry.get(
    environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
  );
  const projectId =
    shell?.projectId ?? loadedProjectId(environmentId, threadId) ?? localParentProjectId;
  return projectId === settings.madohomuProjectId ? { madohomu: true } : {};
}
