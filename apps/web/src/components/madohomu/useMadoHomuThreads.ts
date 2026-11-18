import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  groupMadoHomuThreads,
  madohomuListedThreads,
  resolveMadoHomuSelection,
} from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  useProjects,
  useThreadProjection,
  useThreadShell,
  useThreadStatus,
  useVisibleThreadShells,
} from "../../state/entities";
import { useEnvironmentShellStatus } from "../../state/shell";
import { useSnoozeWakeClock } from "../Sidebar.logic";
import {
  madohomuCreatedThreadIdsAtom,
  madohomuFirstRowId,
  madohomuNamedThread,
  startMadoHomuThread,
} from "../../madohomu";
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
 * The thread MadoHomu shows (see `resolveMadoHomuSelection`). The page, the sidebar highlight
 * and the thread shortcuts all read this one choice.
 */
export function useMadoHomuSelection(environmentId: EnvironmentId) {
  const search = useSearch({ from: "/_chat/madohomu" });
  const { groups, project } = useMadoHomuThreads(environmentId);
  const ref = search.threadId ? scopeThreadRef(environmentId, search.threadId) : null;
  const shell = useThreadShell(ref);
  const detailRef = shell === null ? ref : null;
  const { named, listLoaded } = madohomuNamedThread({
    namedId: search.threadId,
    shell,
    detail: useThreadProjection(detailRef),
    detailStatus: useThreadStatus(detailRef),
    shellStatus: useEnvironmentShellStatus(environmentId),
    created: useAtomValue(madohomuCreatedThreadIdsAtom).ids,
  });
  const selection = resolveMadoHomuSelection({
    namedId: search.threadId,
    named,
    projectId: project?.id ?? null,
    listLoaded,
    firstId: madohomuFirstRowId(groups),
  });
  return { ...selection, namedId: search.threadId, namedLoaded: named !== null };
}

export function useMadoHomuSelectedThreadId(environmentId: EnvironmentId): ThreadId | null {
  return useMadoHomuSelection(environmentId).threadId;
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
