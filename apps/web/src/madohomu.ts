import {
  findUntouchedMadoHomuThread,
  MADOHOMU_NEW_THREAD_TITLE,
  groupMadoHomuThreads,
  isMadoHomuThreadPinned,
  madohomuListedThreads,
  madohomuRuntimeMode,
  selectMadoHomuEnvironment,
  resolveMadoHomuSelection,
} from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import type {
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { composerDraftHasUserContent, useComposerDraftStore } from "./composerDraftStore";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProjects, waitForThreadShell } from "./state/entities";
import { environmentServerConfigsAtom, serverEnvironment } from "./state/server";
import { environmentShell } from "./state/shell";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "./state/threads";
import { waitForAtomValue } from "./state/waitForAtomValue";
import { newThreadId } from "./lib/utils";
import { threadHasStarted } from "./lib/chatThreadActions";
import { scheduledTaskDefaultModel } from "./components/settings/scheduledTasksSettings.logic";
import { providerInstanceEntriesFor } from "./providerInstances";
import { resolveSidebarThreadStatus } from "./components/Sidebar.logic";

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
export const madohomuCreatedThreadIdsAtom = Atom.make<ReadonlySet<ThreadId>>(
  new Set<ThreadId>(),
).pipe(Atom.keepAlive, Atom.withLabel("madohomu:created-thread-ids"));

export function forgetCreatedMadoHomuThread(threadId: ThreadId) {
  const created = appAtomRegistry.get(madohomuCreatedThreadIdsAtom);
  if (!created.has(threadId)) return;
  const ids = new Set(created);
  ids.delete(threadId);
  appAtomRegistry.set(madohomuCreatedThreadIdsAtom, ids);
}

type NamedShell = Pick<EnvironmentThreadShell, "projectId" | "deletedAt" | "archivedAt">;

/**
 * What MadoHomu knows of the thread its URL names. The shell list can leave out idle subagents
 * and older settled threads, so a missing shell falls back to the thread's own detail, and the
 * thread counts as gone only once that detail has settled without it.
 */
export function madohomuNamedThread(input: {
  readonly namedId: ThreadId | null | undefined;
  readonly shell: NamedShell | null;
  readonly detail: EnvironmentThread | null;
  readonly detailStatus: EnvironmentThreadStatus;
  readonly shellStatus: string | null;
  readonly created: ReadonlySet<ThreadId>;
}) {
  const { shell, detail } = input;
  const thread = detail?.projection.thread;
  const named =
    shell ?? (thread ? { projectId: thread.projectId, archivedAt: thread.archivedAt } : null);
  const listLoaded =
    input.shellStatus === "live" &&
    !(input.namedId && input.created.has(input.namedId)) &&
    (!input.namedId ||
      named !== null ||
      input.detailStatus === "live" ||
      input.detailStatus === "deleted");
  return { named, listLoaded };
}

/**
 * The first row MadoHomu falls back to, preferring one outside Snoozed and Settled. A folded
 * section still shows its open row, so a shelved fallback stays visible.
 */
export function madohomuFirstRowId(
  groups: ReadonlyArray<{
    readonly kind: string;
    readonly threads: ReadonlyArray<{ readonly id: ThreadId }>;
  }>,
) {
  const rows = groups.flatMap((group) =>
    group.threads.map((thread) => ({ id: thread.id, kind: group.kind })),
  );
  const first = rows.find((row) => row.kind !== "snoozed" && row.kind !== "settled") ?? rows[0];
  return first?.id ?? null;
}

/** A row whose status label asks for the user: an approval, a question or a waiting guest. */
export function madohomuNeedsUser(thread: Parameters<typeof resolveSidebarThreadStatus>[0]) {
  const status = resolveSidebarThreadStatus(thread);
  return status === "approval" || status === "input" || status === "request";
}

/** Busy and not waiting on the user: a waiting guest keeps a running thread out of Working. */
const madohomuIsWorking = (
  thread: Parameters<typeof resolveSidebarThreadStatus>[0] & Parameters<typeof isThreadWorking>[0],
) => !madohomuNeedsUser(thread) && isThreadWorking(thread);

export function listWebMadoHomuThreads(
  shells: ReadonlyArray<EnvironmentThreadShell>,
  environmentId: EnvironmentId,
  projectId: ProjectId | undefined,
  settings: Pick<ServerSettings, "madohomuThreads">,
  openThreadId: ThreadId | null | undefined,
) {
  return madohomuListedThreads(
    shells.filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.projectId === projectId &&
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        thread.lineage.sideChat !== true,
    ),
    settings,
    openThreadId,
  );
}

export function groupWebMadoHomuThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  settings: Parameters<typeof groupMadoHomuThreads>[1],
  now: string,
) {
  return groupMadoHomuThreads(threads, settings, { now, isWorking: madohomuIsWorking }).map(
    (group) =>
      group.kind === "settled" ? { ...group, threads: sortSettledThreads(group.threads) } : group,
  );
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
  const openThreadId = typeof search.threadId === "string" ? ThreadId.make(search.threadId) : null;
  const threads = listWebMadoHomuThreads(
    appAtomRegistry.get(environmentThreadShells.visibleThreadShellsAtom),
    environmentId,
    project.id,
    config.settings,
    openThreadId,
  );
  // The same list and choice as the sidebar, so commands act on the thread on screen.
  const groups = groupWebMadoHomuThreads(threads, config.settings, new Date().toISOString());
  const openRef = openThreadId ? scopeThreadRef(environmentId, openThreadId) : null;
  const { named, listLoaded } = madohomuNamedThread({
    namedId: openThreadId,
    shell: openRef ? appAtomRegistry.get(environmentThreadShells.threadShellAtom(openRef)) : null,
    detail: openRef ? appAtomRegistry.get(environmentThreadDetails.threadAtom(openRef)) : null,
    detailStatus: openRef
      ? appAtomRegistry.get(environmentThreadDetails.statusAtom(openRef))
      : "empty",
    shellStatus: appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status,
    created: appAtomRegistry.get(madohomuCreatedThreadIdsAtom),
  });
  const { threadId } = resolveMadoHomuSelection({
    namedId: openThreadId,
    named,
    projectId: project.id,
    listLoaded,
    firstId: madohomuFirstRowId(groups),
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
 * project; null when it is not, so the caller takes the normal route. The shell list can leave
 * a thread out (an idle subagent), so its loaded detail, then `knownProjectId` (what the link
 * knows), stand in for the shell.
 */
export function openThreadInMadoHomu(
  router: AnyRouter,
  threadRef: ScopedThreadRef,
  knownProjectId: ProjectId | null = null,
) {
  const context = readMadoHomuContext(router);
  if (context?.environmentId !== threadRef.environmentId) return null;
  const shell = appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef));
  const detail = shell
    ? null
    : appAtomRegistry.get(environmentThreadDetails.threadAtom(threadRef))?.projection.thread;
  const known = shell ?? detail ?? { projectId: knownProjectId, archivedAt: null, deletedAt: null };
  if (known.projectId !== context.project.id || known.archivedAt !== null) return null;
  if (known.deletedAt != null) return null;
  return router.navigate({
    to: "/madohomu",
    search: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
  });
}

type MadoHomuCheckout = { readonly branch: string | null; readonly worktreePath: string | null };
const DEFAULT_CHECKOUT: MadoHomuCheckout = { branch: null, worktreePath: null };

export async function createMadoHomuThread(
  environmentId: EnvironmentId,
  title: string = MADOHOMU_NEW_THREAD_TITLE,
  icon: string | null = null,
  checkout: MadoHomuCheckout = DEFAULT_CHECKOUT,
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
      branch: checkout.branch,
      worktreePath: checkout.worktreePath,
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

/**
 * Opens an empty pinned thread on the source checkout, creating one if needed.
 * Null lets the caller use the normal draft route outside MadoHomu.
 */
export async function startMadoHomuBranchThread(
  router: AnyRouter,
  source: ScopedThreadRef & MadoHomuCheckout & { readonly projectId: ProjectId },
): Promise<boolean | null> {
  const context = readMadoHomuContext(router);
  if (context?.environmentId !== source.environmentId) return null;
  if (context.project.id !== source.projectId) return null;
  return startThreadOnCheckout(router, context, source);
}

const startingThreads = new Map<string, Promise<boolean>>();

export function startMadoHomuThread(router: AnyRouter): Promise<boolean> {
  const context = readMadoHomuContext(router);
  return context
    ? startThreadOnCheckout(router, context, DEFAULT_CHECKOUT)
    : Promise.resolve(false);
}

function startThreadOnCheckout(
  router: AnyRouter,
  context: NonNullable<ReturnType<typeof readMadoHomuContext>>,
  checkout: MadoHomuCheckout,
) {
  const { environmentId, project, groups, settings } = context;
  const key = JSON.stringify([environmentId, project.id, checkout.branch, checkout.worktreePath]);
  const inFlight = startingThreads.get(key);
  if (inFlight) return inFlight;
  const start = async () => {
    const pinned = groups.find((group) => group.kind === "pinned")?.threads ?? [];
    const { getComposerDraft } = useComposerDraftStore.getState();
    const untouched = findUntouchedMadoHomuThread(
      pinned.filter(
        (thread) =>
          thread.branch === checkout.branch &&
          thread.worktreePath === checkout.worktreePath &&
          !threadHasStarted(thread) &&
          !composerDraftHasUserContent(getComposerDraft(scopeThreadRef(environmentId, thread.id))),
      ),
      settings,
    );
    const threadId =
      untouched?.id ?? (await createMadoHomuThread(environmentId, undefined, null, checkout));
    if (!threadId) return false;
    const open = router.navigate({ to: "/madohomu", search: { environmentId, threadId } });
    if (untouched) {
      await open;
    } else {
      // Keep sharing the start until the next click can find the new pin in both feeds.
      await Promise.all([
        open,
        waitForThreadShell(scopeThreadRef(environmentId, threadId)),
        waitForAtomValue({
          registry: appAtomRegistry,
          atom: environmentServerConfigsAtom,
          predicate: (configs) =>
            isMadoHomuThreadPinned(configs.get(environmentId)?.settings.madohomuThreads[threadId]),
          timeoutMs: 5_000,
        }),
      ]);
    }
    return true;
  };
  const pending = start().finally(() => startingThreads.delete(key));
  startingThreads.set(key, pending);
  return pending;
}
