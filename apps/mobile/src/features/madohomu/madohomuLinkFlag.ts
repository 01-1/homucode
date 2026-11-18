import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells, environmentThreads } from "../../state/threads";
import {
  isMadoHomuThreadRoute,
  type MadoHomuThreadRouteParams,
} from "../threads/thread-route-state";

function loadedProjectId(environmentId: EnvironmentId, threadId: ThreadId): ProjectId | undefined {
  const atom = environmentThreads.stateAtom(environmentId, threadId);
  if (!appAtomRegistry.getNodes().has(atom)) return undefined;
  return AsyncResult.value(appAtomRegistry.get(atom)).pipe(
    Option.flatMap((state) => state.data),
    Option.map((projection) => projection.thread.projectId),
    Option.getOrUndefined,
  );
}

type ThreadTarget = { readonly environmentId: string; readonly threadId: string };
type StackState =
  | {
      readonly index: number;
      readonly routes: ReadonlyArray<{ readonly name: string; readonly params?: object }>;
    }
  | undefined;

type ActiveThreadParams = Partial<ThreadTarget> & MadoHomuThreadRouteParams;

function activeThreadParams(state: StackState): ActiveThreadParams | undefined {
  const thread = state?.routes
    .slice(0, state.index + 1)
    .findLast((route) => route.name === "Thread");
  return thread?.params as ActiveThreadParams | undefined;
}

function knownProjectId(target: ThreadTarget): ProjectId | undefined {
  const environmentId = EnvironmentId.make(target.environmentId);
  const threadId = ThreadId.make(target.threadId);
  const shell = appAtomRegistry.get(
    environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
  );
  return shell?.projectId ?? loadedProjectId(environmentId, threadId);
}

function activeThreadIsMadoHomu(params: ActiveThreadParams | undefined): boolean {
  if (params === undefined) return false;
  if (params.madohomu === true) return true;
  if (!params.madohomuLinkProjectId || !params.environmentId || !params.threadId) return false;
  return isMadoHomuThreadRoute(
    params,
    knownProjectId({ environmentId: params.environmentId, threadId: params.threadId }),
  );
}

export function madohomuRouteFlag(state: StackState): { readonly madohomu?: true } {
  return activeThreadIsMadoHomu(activeThreadParams(state)) ? { madohomu: true } : {};
}

export function madohomuLinkFlag(
  state: StackState,
  target: ThreadTarget,
  localParentProjectId?: ProjectId,
): MadoHomuThreadRouteParams {
  const source = activeThreadParams(state);
  if (source?.environmentId !== target.environmentId || !activeThreadIsMadoHomu(source)) return {};
  const environmentId = EnvironmentId.make(target.environmentId);
  const settings = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.settings;
  if (settings?.madohomuEnabled !== true || settings.madohomuProjectId === null) return {};
  const projectId = knownProjectId(target) ?? localParentProjectId;
  if (projectId === undefined) return { madohomuLinkProjectId: settings.madohomuProjectId };
  return projectId === settings.madohomuProjectId ? { madohomu: true } : {};
}
