import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { madohomuRouteFlag } from "../threads/thread-route-state";

/**
 * `{ madohomu: true }` for a thread opened from a MadoHomu thread screen when the target is in
 * MadoHomu's project, so it opens without the project subtitle. Other targets open as usual.
 */
export function madohomuLinkFlag(
  state: Parameters<typeof madohomuRouteFlag>[0],
  target: { readonly environmentId: string; readonly threadId: string },
): { readonly madohomu?: true } {
  if (madohomuRouteFlag(state).madohomu !== true) return {};
  const environmentId = EnvironmentId.make(target.environmentId);
  const settings = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.settings;
  const shell = appAtomRegistry.get(
    environmentThreadShells.threadShellAtom(
      scopeThreadRef(environmentId, ThreadId.make(target.threadId)),
    ),
  );
  return settings?.madohomuEnabled === true &&
    shell !== null &&
    shell.projectId === settings.madohomuProjectId
    ? { madohomu: true }
    : {};
}
