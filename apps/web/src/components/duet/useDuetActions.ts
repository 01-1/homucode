import { useAtomValue } from "@effect/atom-react";
import { duetMorningBriefInput, findDuetMorningBriefThread } from "@t3tools/client-runtime/duet";
import {
  ScheduledTaskId,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { createDuetThread } from "../../duet";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";

export function useDuetActions(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const project =
    projects.find((p) => p.environmentId === environmentId && p.id === settings.duetProjectId) ??
    null;
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
  const task = taskQuery.data?.tasks.find((t) => t.id === settings.duetMorningBriefTaskId) ?? null;
  const pin = useAtomCommand(threadEnvironment.pin);
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
  const createThread = (title = "New thread", icon: string | null = null) =>
    createDuetThread(environmentId, title, icon);
  const disableBrief = async () => {
    if (!settings.duetMorningBriefTaskId) return true;
    if (taskQuery.isSuccess && !task) return true;
    const result = await setEnabled({
      environmentId,
      input: { id: settings.duetMorningBriefTaskId, enabled: false },
    });
    return result._tag === "Success";
  };
  const setMorningBrief = async (enabled: boolean, timeOfDay: string) => {
    if (!enabled) return disableBrief();
    if (!project || !modelSelection) return false;
    const existing = findDuetMorningBriefThread(
      threads,
      environmentId,
      project.id,
      task?.threadId ?? null,
    );
    const threadId = existing?.id ?? (await createThread("Morning brief", "☀️"));
    if (!threadId) return false;
    if (existing) {
      if ((await pin({ environmentId, input: { threadId } }))._tag !== "Success") return false;
      if (
        !(await save({
          duetThreads: {
            [threadId]: { icon: "☀️", prompt: settings.duetThreads[threadId]?.prompt ?? "" },
          },
        }))
      )
        return false;
    }
    const result = await upsert({
      environmentId,
      input: duetMorningBriefInput({
        id:
          task?.id ?? settings.duetMorningBriefTaskId ?? ScheduledTaskId.make(crypto.randomUUID()),
        timeOfDay,
        projectId: project.id,
        threadId,
        modelSelection,
        creationSource: "web",
      }),
    });
    if (result._tag !== "Success") return false;
    return save({ duetMorningBriefTaskId: result.value.task.id });
  };
  const changeProject = (projectId: ProjectId | null) => save({ duetProjectId: projectId });
  const setThreadSettings = (
    threadId: ThreadId,
    icon: string | null,
    prompt: string,
    color: string | null,
  ) => save({ duetThreads: { [threadId]: { icon, prompt, color } } });
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
    setThreadSettings,
  };
}
