import { useAtomValue } from "@effect/atom-react";
import {
  MADOHOMU_NEW_THREAD_TITLE,
  madohomuMorningBriefInput,
  madohomuRuntimeMode,
  findMadoHomuMorningBriefThread,
} from "@t3tools/client-runtime/madohomu";
import {
  ScheduledTaskId,
  type MadoHomuThreadSettings,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { createMadoHomuThread } from "../../madohomu";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";

export function useMadoHomuActions(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const project =
    projects.find(
      (p) => p.environmentId === environmentId && p.id === settings.madohomuProjectId,
    ) ?? null;
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const modelSelection = scheduledTaskDefaultModel(
    settings,
    project,
    providerInstanceEntriesFor(providers, settings, project?.id ?? null),
  );
  const taskQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const task =
    taskQuery.data?.tasks.find((t) => t.id === settings.madohomuMorningBriefTaskId) ?? null;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask);
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canSchedule = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );

  const save = async (patch: Parameters<typeof update>[0]["input"]["patch"]) => {
    const result = await update({ environmentId, input: { patch } });
    return result._tag === "Success";
  };
  const createThread = (title: string = MADOHOMU_NEW_THREAD_TITLE, icon: string | null = null) =>
    createMadoHomuThread(environmentId, title, icon);
  const disableBrief = async () => {
    if (!settings.madohomuMorningBriefTaskId) return true;
    if (taskQuery.isSuccess && !task) return true;
    const result = await setEnabled({
      environmentId,
      input: { id: settings.madohomuMorningBriefTaskId, enabled: false },
    });
    return result._tag === "Success";
  };
  const setMorningBrief = async (enabled: boolean, timeOfDay: string) => {
    if (!enabled) return disableBrief();
    if (!project || !modelSelection) return false;
    const existing = findMadoHomuMorningBriefThread(
      threads,
      environmentId,
      project.id,
      task?.threadId ?? null,
    );
    const threadId = existing?.id ?? (await createThread("Morning brief", "☀️"));
    if (!threadId) return false;
    if (existing) {
      if (
        !(await save({
          madohomuThreads: {
            [threadId]: {
              ...settings.madohomuThreads[threadId],
              icon: "☀️",
              prompt: settings.madohomuThreads[threadId]?.prompt ?? "",
              pinned: true,
            },
          },
        }))
      )
        return false;
    }
    const result = await upsert({
      environmentId,
      input: madohomuMorningBriefInput({
        id: task?.id ?? settings.madohomuMorningBriefTaskId ?? ScheduledTaskId.make(randomUUID()),
        timeOfDay,
        projectId: project.id,
        threadId,
        modelSelection,
        runtimeMode: madohomuRuntimeMode(settings, project),
        creationSource: "web",
      }),
    });
    if (result._tag !== "Success") return false;
    return save({ madohomuMorningBriefTaskId: result.value.task.id });
  };
  const changeProject = (projectId: ProjectId | null) => save({ madohomuProjectId: projectId });
  /** A thread's entry with `patch` applied; a patch replaces the whole entry, so this keeps the rest. */
  const threadEntry = (
    threadId: ThreadId,
    patch: Partial<MadoHomuThreadSettings>,
  ): MadoHomuThreadSettings => ({
    icon: null,
    prompt: "",
    ...settings.madohomuThreads[threadId],
    ...patch,
  });
  const patchThread = (threadId: ThreadId, patch: Partial<MadoHomuThreadSettings>) =>
    save({ madohomuThreads: { [threadId]: threadEntry(threadId, patch) } });
  const setThreadSettings = (
    threadId: ThreadId,
    icon: string | null,
    prompt: string,
    color: string | null,
    pinned: boolean,
  ) => patchThread(threadId, { icon, prompt, color, pinned });
  return {
    settings,
    project,
    modelSelection,
    task,
    taskQuery,
    canWrite,
    canSchedule,
    save,
    createThread,
    setMorningBrief,
    changeProject,
    threadEntry,
    patchThread,
    setThreadSettings,
  };
}
