import {
  filterMadoHomuCodeThreads,
  type isMadoHomuThreadShownInCode,
} from "@t3tools/client-runtime/madohomu";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { useEnvironments } from "../../state/environments";

/**
 * The T3 Code thread lists without the threads MadoHomu keeps to itself. A search
 * still finds them, and the open thread stays listed.
 */
export function useMadoHomuCodeThreads<
  T extends Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">,
>(threads: ReadonlyArray<T>, searchQuery: string, openThreadKey: string | null = null) {
  const { environments } = useEnvironments();
  const settingsByEnvironment = useMemo(
    () =>
      new Map<EnvironmentId, Parameters<typeof isMadoHomuThreadShownInCode>[0]>(
        environments.flatMap((environment) =>
          environment.serverConfig
            ? [[environment.environmentId, environment.serverConfig.settings]]
            : [],
        ),
      ),
    [environments],
  );
  const searching = searchQuery.trim().length > 0;
  return useMemo(
    () =>
      searching
        ? threads
        : filterMadoHomuCodeThreads(
            threads,
            settingsByEnvironment,
            (thread) => scopedThreadKey(thread.environmentId, thread.id) === openThreadKey,
          ),
    [openThreadKey, searching, settingsByEnvironment, threads],
  );
}
