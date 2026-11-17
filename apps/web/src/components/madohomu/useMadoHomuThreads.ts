import { groupMadoHomuThreads } from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useSearch } from "@tanstack/react-router";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useSnoozeWakeClock } from "../Sidebar.logic";

/** MadoHomu's project threads, grouped the way the sidebar shows them. */
export function useMadoHomuThreads(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const project =
    useProjects().find(
      (p) => p.environmentId === environmentId && p.id === settings.madohomuProjectId,
    ) ?? null;
  const projectThreads = useVisibleThreadShells().filter(
    (t) =>
      t.environmentId === environmentId &&
      t.projectId === project?.id &&
      t.deletedAt === null &&
      t.archivedAt === null,
  );
  // Subagents report to their parent; only ones the user filed get a row, as in T3 Code.
  const threads = projectThreads.filter(
    (t) =>
      t.lineage.relationshipToParent !== "subagent" ||
      settings.madohomuThreads[t.id] !== undefined,
  );
  const clockMs = useSnoozeWakeClock(threads);
  const now = new Date(clockMs).toISOString();
  const groups = groupMadoHomuThreads(threads, settings, { now, isWorking: isThreadWorking });
  return { settings, project, projectThreads, threads, groups, now };
}

/**
 * The thread MadoHomu shows: the one the URL names, or else the sidebar's first row. The page
 * and the sidebar both read this, so the open thread is always the highlighted row.
 */
export function useMadoHomuSelectedThreadId(environmentId: EnvironmentId): ThreadId | null {
  const search = useSearch({ from: "/_chat/madohomu" });
  const { projectThreads, groups } = useMadoHomuThreads(environmentId);
  if (search.threadId && projectThreads.some((t) => t.id === search.threadId)) {
    return search.threadId;
  }
  return groups.flatMap((g) => g.threads)[0]?.id ?? null;
}
