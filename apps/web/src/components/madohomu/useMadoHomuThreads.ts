import {
  groupMadoHomuThreads,
  madohomuListedThreads,
  selectMadoHomuThread,
} from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useSnoozeWakeClock } from "../Sidebar.logic";
import { startMadoHomuThread } from "../../madohomu";
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
  const search = useSearch({ from: "/_chat/madohomu" });
  const threads = madohomuListedThreads(projectThreads, settings, search.threadId);
  const clockMs = useSnoozeWakeClock(threads);
  const now = new Date(clockMs).toISOString();
  const groups = groupMadoHomuThreads(threads, settings, { now, isWorking: isThreadWorking });
  return { settings, project, threads, groups, now };
}

/**
 * The thread MadoHomu shows: the one the URL names, or else the sidebar's first row. The page
 * and the sidebar both read this, so the open thread is always the highlighted row.
 */
export function useMadoHomuSelectedThreadId(environmentId: EnvironmentId): ThreadId | null {
  const search = useSearch({ from: "/_chat/madohomu" });
  const { groups } = useMadoHomuThreads(environmentId);
  return selectMadoHomuThread(groups, search.threadId)?.id ?? null;
}

/**
 * MadoHomu's "New thread" button, the same path as the keyboard command (`startMadoHomuThread`).
 * `onOpen` runs first (the sidebar closes its phone sheet there).
 */
export function useMadoHomuNewThread(environmentId: EnvironmentId, onOpen?: () => void) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const createThread = () => {
    if (creatingRef.current) return Promise.resolve();
    onOpen?.();
    creatingRef.current = true;
    setCreating(true);
    return startMadoHomuThread(router)
      .then((started) => {
        if (!started) toastManager.add({ type: "error", title: "Could not create thread" });
      })
      .finally(() => {
        creatingRef.current = false;
        setCreating(false);
      });
  };
  return { createThread, creating };
}
