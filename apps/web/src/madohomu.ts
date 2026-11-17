import { madohomuRuntimeMode, selectMadoHomuEnvironment } from "@t3tools/client-runtime/madohomu";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProjects } from "./state/entities";
import { environmentServerConfigsAtom, serverEnvironment } from "./state/server";
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
  const threads = appAtomRegistry
    .get(environmentThreadShells.visibleThreadShellsAtom)
    .filter(
      (t) =>
        t.environmentId === environmentId &&
        t.projectId === project.id &&
        t.deletedAt === null &&
        t.archivedAt === null,
    );
  const thread = threads.find((t) => t.id === search.threadId) ?? threads[0] ?? null;
  return {
    environmentId,
    project,
    thread,
    threadRef: thread ? scopeThreadRef(environmentId, thread.id) : null,
  };
}

export async function createMadoHomuThread(
  environmentId: EnvironmentId,
  title = "New thread",
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
  const created = await runAtomCommand(appAtomRegistry, threadEnvironment.create, {
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
  if (created._tag !== "Success") return null;
  const saved = await runAtomCommand(appAtomRegistry, serverEnvironment.updateSettings, {
    environmentId,
    input: { patch: { madohomuThreads: { [threadId]: { icon, prompt: "", pinned: true } } } },
  });
  return saved._tag === "Success" ? threadId : null;
}

export async function startMadoHomuThread(router: AnyRouter) {
  const context = readMadoHomuContext(router);
  if (!context) return false;
  const threadId = await createMadoHomuThread(context.environmentId);
  if (!threadId) return false;
  await router.navigate({
    to: "/madohomu",
    search: { environmentId: context.environmentId, threadId, tab: "chat" },
  });
  return true;
}
