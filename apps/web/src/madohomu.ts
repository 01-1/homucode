import {
  findUntouchedMadoHomuThread,
  MADOHOMU_NEW_THREAD_TITLE,
  groupMadoHomuThreads,
  isMadoHomuThreadPinned,
  madohomuListedThreads,
  madohomuRuntimeMode,
  resolveMadoHomuDestination,
  writeMadoHomuProject,
  resolveMadoHomuSelection,
} from "@t3tools/client-runtime/madohomu";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import type {
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type ServerSettings,
  type ServerSettingsPatch,
  ThreadId,
} from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { environmentCatalog } from "./connection/catalog";
import { composerDraftHasUserContent, useComposerDraftStore } from "./composerDraftStore";
import {
  readLocalStorageValue,
  setLocalStorageItem,
  subscribeLocalStorageKey,
} from "./hooks/useLocalStorage";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readEnvironment } from "./state/environments";
import { readProjects, waitForThreadShell } from "./state/entities";
import { environmentServerConfigsAtom, serverEnvironment } from "./state/server";
import { environmentShell, expectsPrimaryEnvironment } from "./state/shell";
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

const DEVICE_DESTINATION_KEY = "t3code:madohomu-destination";
const DEVICE_DESKTOP_LAUNCHER_ENABLED_KEY = "t3code:madohomu-desktop-launcher-enabled";

const deviceDestinationAtom = Atom.make((get): EnvironmentId | null => {
  const read = () => readLocalStorageValue(DEVICE_DESTINATION_KEY, null, EnvironmentId);
  if (typeof window !== "undefined") {
    get.addFinalizer(subscribeLocalStorageKey(DEVICE_DESTINATION_KEY, () => get.setSelf(read())));
  }
  return read();
});

const deviceDesktopLauncherEnabledAtom = Atom.make((get) => {
  const read = () =>
    readLocalStorageValue(DEVICE_DESKTOP_LAUNCHER_ENABLED_KEY, false, Schema.Boolean);
  if (typeof window !== "undefined") {
    get.addFinalizer(
      subscribeLocalStorageKey(DEVICE_DESKTOP_LAUNCHER_ENABLED_KEY, () => get.setSelf(read())),
    );
  }
  return read();
});

export const madohomuDesktopLauncherEnabledAtom = Atom.make((get) => {
  const primary = get(primaryEnvironmentIdAtom);
  if (primary !== null) {
    return get(environmentServerConfigsAtom).get(primary)?.settings.madohomuDesktopAppEnabled;
  }
  return expectsPrimaryEnvironment() ? undefined : get(deviceDesktopLauncherEnabledAtom);
});

export const canUpdateMadoHomuDesktopLauncherAtom = Atom.make((get) => {
  if (get(madohomuDesktopLauncherEnabledAtom) === undefined) return false;
  const primary = get(primaryEnvironmentIdAtom);
  return primary === null || get(serverEnvironment.updateSettings.permissionAtom(primary));
});

export const madohomuDestinationAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const configs = get(environmentServerConfigsAtom);
  return resolveMadoHomuDestination(
    [...enabledEnvironmentIds(catalog)].map((environmentId) => ({
      environmentId,
      settings: configs.get(environmentId)?.settings ?? null,
    })),
  );
});

export const madohomuSavedDestinationEnvironmentIdAtom = Atom.make(
  (get) => get(madohomuDestinationAtom).savedEnvironmentId,
);

export const madohomuDestinationEnvironmentIdAtom = Atom.make((get) => {
  const destination = get(madohomuDestinationAtom);
  // Read a legacy browser selection only before this client has any shared settings host.
  return destination.anchorEnvironmentId === null && !expectsPrimaryEnvironment()
    ? get(deviceDestinationAtom)
    : destination.environmentId;
});

export const madohomuDefaultEnvironmentIdAtom = Atom.make(
  (get) =>
    get(madohomuDestinationEnvironmentIdAtom) ?? get(madohomuDestinationAtom).anchorEnvironmentId,
);

export const canOpenMadoHomuAtom = Atom.make((get) => {
  const destination = get(madohomuDestinationEnvironmentIdAtom);
  if (destination === null) return false;
  return get(environmentServerConfigsAtom).get(destination)?.settings.madohomuEnabled !== false;
});

export const madohomuProjectSelectionPendingAtom = Atom.make(false).pipe(Atom.keepAlive);

async function writeMadoHomuSettings(environmentId: EnvironmentId, patch: ServerSettingsPatch) {
  const result = await runAtomCommand(appAtomRegistry, serverEnvironment.updateSettings, {
    environmentId,
    input: { patch },
  });
  if (result._tag === "Success") return result.value;
  throw squashAtomCommandFailure(result);
}

export async function saveMadoHomuDesktopLauncherEnabled(enabled: boolean) {
  if (!appAtomRegistry.get(canUpdateMadoHomuDesktopLauncherAtom)) return false;
  const primary = appAtomRegistry.get(primaryEnvironmentIdAtom);
  if (primary === null) {
    setLocalStorageItem(DEVICE_DESKTOP_LAUNCHER_ENABLED_KEY, enabled, Schema.Boolean);
    appAtomRegistry.refresh(deviceDesktopLauncherEnabledAtom);
  } else {
    await writeMadoHomuSettings(primary, { madohomuDesktopAppEnabled: enabled });
  }
  return true;
}

export async function saveMadoHomuProject(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
): Promise<boolean> {
  if (appAtomRegistry.get(madohomuProjectSelectionPendingAtom)) return false;
  const destination = appAtomRegistry.get(madohomuDestinationAtom);
  const readHost = (id: EnvironmentId) => {
    const host = readEnvironment(id);
    return (
      host && {
        label: host.label,
        connected: host.connection.phase === "connected",
        settingsLoaded: host.serverConfig !== null,
        canWrite: appAtomRegistry.get(serverEnvironment.updateSettings.permissionAtom(id)),
      }
    );
  };

  appAtomRegistry.set(madohomuProjectSelectionPendingAtom, true);
  try {
    await writeMadoHomuProject(
      destination,
      { environmentId, projectId },
      readHost,
      writeMadoHomuSettings,
    );
    return true;
  } finally {
    appAtomRegistry.set(madohomuProjectSelectionPendingAtom, false);
  }
}

/** Threads this client just made: until each one's shell arrives, a link to it is loading. */
export const madohomuCreatedThreadIdsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive,
  Atom.withLabel("madohomu:created-thread-ids"),
);

export function forgetCreatedMadoHomuThread(ref: ScopedThreadRef) {
  const created = appAtomRegistry.get(madohomuCreatedThreadIdsAtom);
  const key = threadKey(ref);
  if (!created.has(key)) return;
  const ids = new Set(created);
  ids.delete(key);
  appAtomRegistry.set(madohomuCreatedThreadIdsAtom, ids);
}

type NamedShell = Pick<EnvironmentThreadShell, "projectId" | "deletedAt" | "archivedAt">;

/**
 * What MadoHomu knows of the thread its URL names. The shell list can leave out idle subagents
 * and older settled threads, so a missing shell falls back to the thread's own detail, and the
 * thread counts as gone only once that detail has settled without it.
 */
export function madohomuNamedThread(input: {
  readonly ref: ScopedThreadRef | null;
  readonly shell: NamedShell | null;
  readonly detail: EnvironmentThread | null;
  readonly detailStatus: EnvironmentThreadStatus;
  readonly shellStatus: string | null;
  readonly created: ReadonlySet<string>;
}) {
  const { shell, detail } = input;
  const thread = detail?.projection.thread;
  const named =
    shell ?? (thread ? { projectId: thread.projectId, archivedAt: thread.archivedAt } : null);
  const listLoaded =
    input.shellStatus === "live" &&
    !(input.ref && input.created.has(threadKey(input.ref))) &&
    (!input.ref ||
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
      : appAtomRegistry.get(madohomuDefaultEnvironmentIdAtom);
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
    ref: openRef,
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
  const ref = scopeThreadRef(environmentId, threadId);
  const created = appAtomRegistry.get(madohomuCreatedThreadIdsAtom);
  appAtomRegistry.set(madohomuCreatedThreadIdsAtom, new Set(created).add(threadKey(ref)));
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
    forgetCreatedMadoHomuThread(ref);
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
