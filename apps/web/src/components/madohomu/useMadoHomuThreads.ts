import {
  findUntouchedMadoHomuThread,
  groupMadoHomuThreads,
} from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useSnoozeWakeClock } from "../Sidebar.logic";
import { createMadoHomuThread } from "../../madohomu";
import { toastManager } from "../ui/toast";

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

/**
 * MadoHomu's "New thread": reopens an untouched empty one it made before, otherwise makes one,
 * then opens it. `onOpen` runs before navigating (the sidebar closes its phone sheet there).
 */
export function useMadoHomuNewThread(environmentId: EnvironmentId, onOpen?: () => void) {
  const navigate = useNavigate();
  const { settings, groups } = useMadoHomuThreads(environmentId);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const open = (threadId: ThreadId) => {
    onOpen?.();
    void navigate({ to: "/madohomu", search: { environmentId, threadId } });
  };
  const createThread = async () => {
    const untouched = findUntouchedMadoHomuThread(
      groups.find((g) => g.kind === "pinned")?.threads ?? [],
      settings,
    );
    if (untouched) return open(untouched.id);
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const id = await createMadoHomuThread(environmentId);
      if (id) open(id);
      else toastManager.add({ type: "error", title: "Could not create thread" });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };
  return { createThread, creating };
}
