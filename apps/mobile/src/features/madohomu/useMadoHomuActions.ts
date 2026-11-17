import { useAtomValue } from "@effect/atom-react";
import {
  madohomuMorningBriefInput,
  madohomuRuntimeMode,
  findMadoHomuMorningBriefThread,
} from "@t3tools/client-runtime/madohomu";
import {
  DEFAULT_SERVER_SETTINGS,
  AuthOrchestrationOperateScope,
  ScheduledTaskId,
  ThreadId,
  type EnvironmentId,
  type ServerSettingsPatch,
} from "@t3tools/contracts";

import { uuidv4 } from "../../lib/uuid";
import { useProjects, useEnvironmentServerConfig, useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";

export function useMadoHomuActions(environmentId: EnvironmentId) {
  const config = useEnvironmentServerConfig(environmentId);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const projects = useProjects();
  const threads = useThreadShells();
  const project =
    projects.find(
      (candidate) =>
        candidate.environmentId === environmentId &&
        candidate.id === settings.madohomuProjectId &&
        candidate.archivedAt === null,
    ) ?? null;
  const modelSelection = scheduledTaskDefaultModel(config, project);
  const taskQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const task =
    taskQuery.data?.tasks.find((row) => row.id === settings.madohomuMorningBriefTaskId) ?? null;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const create = useAtomCommand(threadEnvironment.create);
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask);
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canSchedule = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );

  const save = async (patch: ServerSettingsPatch) =>
    (await update({ environmentId, input: { patch } }))._tag === "Success";

  const createThread = async (title = "New thread", icon: string | null = null) => {
    if (!settings.madohomuEnabled || !project || !modelSelection || !canWrite || !canOperate)
      return null;
    const threadId = ThreadId.make(uuidv4());
    const result = await create({
      environmentId,
      input: {
        threadId,
        projectId: project.id,
        title,
        modelSelection,
        runtimeMode: madohomuRuntimeMode(settings, project),
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        creationSource: "mobile",
      },
    });
    if (result._tag !== "Success") return null;
    return (await save({ madohomuThreads: { [threadId]: { icon, prompt: "", pinned: true } } }))
      ? threadId
      : null;
  };

  const setMorningBrief = async (enabled: boolean, timeOfDay: string) => {
    if (!enabled) {
      if (!settings.madohomuMorningBriefTaskId || (taskQuery.isSuccess && !task)) return true;
      return (
        (
          await setEnabled({
            environmentId,
            input: { id: settings.madohomuMorningBriefTaskId, enabled: false },
          })
        )._tag === "Success"
      );
    }
    if (!settings.madohomuEnabled || !project || !modelSelection || !taskQuery.isSuccess)
      return false;
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
        id: task?.id ?? settings.madohomuMorningBriefTaskId ?? ScheduledTaskId.make(uuidv4()),
        projectId: project.id,
        threadId,
        modelSelection,
        runtimeMode: madohomuRuntimeMode(settings, project),
        timeOfDay,
        creationSource: "mobile",
      }),
    });
    return result._tag === "Success" && save({ madohomuMorningBriefTaskId: result.value.task.id });
  };

  return {
    settings,
    project,
    modelSelection,
    task,
    taskQuery,
    canWrite,
    canCreate: canOperate,
    canSchedule,
    save,
    createThread,
    setMorningBrief,
  };
}
