import {
  findUntouchedMadoHomuThread,
  MADOHOMU_NEW_THREAD_TITLE,
  groupMadoHomuThreads,
  madohomuListedThreads,
  madohomuRuntimeMode,
  selectMadoHomuEnvironment,
  resolveMadoHomuSelection,
} from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProjects } from "./state/entities";
import { environmentServerConfigsAtom, serverEnvironment } from "./state/server";
import { environmentShell } from "./state/shell";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { environmentThreadShells, threadEnvironment } from "./state/threads";
import { newThreadId } from "./lib/utils";
import { scheduledTaskDefaultModel } from "./components/settings/scheduledTasksSettings.logic";
import { providerInstanceEntriesFor } from "./providerInstances";

export const madohomuDestinationEnvironmentIdAtom = Atom.make((get) => {
  const configs = get(environmentServerConfigsAtom);
  const primary = get(primaryEnvironmentIdAtom);
  return selectMadoHomuEnvironment(
    primary,
    [...configs].map(([environmentId, config]) => ({
      environmentId,
      madohomuEnabled: config.settings.madohomuEnabled,
      madohomuDesktopAppEnabled: config.settings.madohomuDesktopAppEnabled,
    })),
  );
});

/** Threads this client just made: until each one's shell arrives, a link to it is loading. */
export const madohomuCreatedThreadIdsAtom = Atom.make<ReadonlySet<ThreadId>>(new Set()).pipe(
  Atom.keepAlive,
  Atom.withLabel("madohomu:created-thread-ids"),
);

export function forgetCreatedMadoHomuThread(threadId: ThreadId) {
  const created = appAtomRegistry.get(madohomuCreatedThreadIdsAtom);
  if (!created.has(threadId)) return;
  const next = new Set(created);
  next.delete(threadId);
  appAtomRegistry.set(madohomuCreatedThreadIdsAtom, next);
}

/** Whether a missing named thread is gone: the list is live and this client is not making it. */
export function madohomuListLoaded(
  status: string | null,
  created: ReadonlySet<ThreadId>,
  namedId: ThreadId | null | undefined,
) {
  return status === "live" && !(namedId && created.has(namedId));
}

export function readMadoHomuContext(router: AnyRouter) {
  if (router.state.location?.pathname !== "/madohomu") return null;
  const search = router.state.location.search as Record<string, unknown>;
  const environmentId =
    typeof search.environmentId === "string"
      ? EnvironmentId.make(search.environmentId)
      : appAtomRegistry.get(madohomuDestinationEnvironmentIdAtom);
  if (!environmentId) return null;
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (!config?.settings.madohomuEnabled) return null;
  const project = readProjects().find(
    (p) => p.environmentId === environmentId && p.id === config.settings.madohomuProjectId,
  );
  if (!project) return null;
  const projectThreads = appAtomRegistry
    .get(environmentThreadShells.visibleThreadShellsAtom)
    .filter(
      (t) =>
        t.environmentId === environmentId &&
        t.projectId === project.id &&
        t.deletedAt === null &&
        t.archivedAt === null,
    );
  const openThreadId = typeof search.threadId === "string" ? ThreadId.make(search.threadId) : null;
  // The same list and choice as the sidebar, so commands act on the thread on screen.
  const groups = groupMadoHomuThreads(
    madohomuListedThreads(projectThreads, config.settings, openThreadId),
    config.settings,
    { now: new Date().toISOString(), isWorking: isThreadWorking },
  );
  const { threadId } = resolveMadoHomuSelection({
    namedId: openThreadId,
    named: openThreadId
      ? appAtomRegistry.get(
          environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, openThreadId)),
        )
      : null,
    projectId: project.id,
    listLoaded: madohomuListLoaded(
      appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status,
      appAtomRegistry.get(madohomuCreatedThreadIdsAtom),
      openThreadId,
    ),
    firstId: groups.flatMap((group) => group.threads)[0]?.id ?? null,
  });
  return {
    environmentId,
    project,
    groups,
    settings: config.settings,
    threadRef: threadId ? scopeThreadRef(environmentId, threadId) : null,
  };
}

/**
 * Opens a thread inside MadoHomu when MadoHomu is the current view and the thread is in its
 * project; null when it is not, so the caller takes the normal route.
 */
export function openThreadInMadoHomu(router: AnyRouter, threadRef: ScopedThreadRef) {
  const context = readMadoHomuContext(router);
  if (context?.environmentId !== threadRef.environmentId) return null;
  const shell = appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef));
  if (shell?.projectId !== context.project.id) return null;
  return router.navigate({
    to: "/madohomu",
    search: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
  });
}

export async function createMadoHomuThread(
  environmentId: EnvironmentId,
  title: string = MADOHOMU_NEW_THREAD_TITLE,
  icon: string | null = null,
): Promise<ThreadId | null> {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (!config?.settings.madohomuEnabled) return null;
  const project = readProjects().find(
    (p) => p.environmentId === environmentId && p.id === config.settings.madohomuProjectId,
  );
  if (!project) return null;
  const modelSelection = scheduledTaskDefaultModel(
    config.settings,
    project,
    providerInstanceEntriesFor(config.providers, config.settings, project.id),
  );
  if (!modelSelection) return null;
  const threadId = newThreadId();
  const created = appAtomRegistry.get(madohomuCreatedThreadIdsAtom);
  appAtomRegistry.set(madohomuCreatedThreadIdsAtom, new Set(created).add(threadId));
  const result = await runAtomCommand(appAtomRegistry, threadEnvironment.create, {
    environmentId,
    input: {
      threadId,
      projectId: project.id,
      title,
      modelSelection,
      runtimeMode: madohomuRuntimeMode(config.settings, project),
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    },
  });
  if (result._tag !== "Success") {
    forgetCreatedMadoHomuThread(threadId);
    return null;
  }
  const saved = await runAtomCommand(appAtomRegistry, serverEnvironment.updateSettings, {
    environmentId,
    input: { patch: { madohomuThreads: { [threadId]: { icon, prompt: "", pinned: true } } } },
  });
  return saved._tag === "Success" ? threadId : null;
}

// One New thread at a time: a second press while one is being made would miss it and make another.
let startingThread: Promise<boolean> | null = null;

export function startMadoHomuThread(router: AnyRouter): Promise<boolean> {
  startingThread ??= startThread(router).finally(() => {
    startingThread = null;
  });
  return startingThread;
}

async function startThread(router: AnyRouter) {
  const context = readMadoHomuContext(router);
  if (!context) return false;
  // Reopens an untouched empty "New thread" instead of making another.
  const untouched = findUntouchedMadoHomuThread(
    context.groups
      .filter((group) => group.kind === "pinned" || group.kind === "custom")
      .flatMap((group) => group.threads),
    context.settings,
  );
  const threadId = untouched?.id ?? (await createMadoHomuThread(context.environmentId));
  if (!threadId) return false;
  await router.navigate({
    to: "/madohomu",
    search: { environmentId: context.environmentId, threadId },
  });
  return true;
}
