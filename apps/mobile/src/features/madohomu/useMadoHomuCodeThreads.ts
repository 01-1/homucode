import { useAtomValue } from "@effect/atom-react";
import { filterMadoHomuCodeThreads } from "@t3tools/client-runtime/madohomu";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { environmentPresentations } from "../../state/presentation";

/**
 * The T3 Code thread lists without the threads MadoHomu keeps to itself. A search
 * still finds them, and the open thread stays listed.
 */
export function useMadoHomuCodeThreads<
  T extends Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">,
>(threads: ReadonlyArray<T>, searchQuery: string, openThreadKey: string | null = null) {
  const configs = useAtomValue(environmentPresentations.serverConfigsAtom);
  const settingsByEnvironment = useMemo(
    () =>
      new Map(
        [...configs].map(([environmentId, config]) => [environmentId, config.settings] as const),
      ),
    [configs],
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
