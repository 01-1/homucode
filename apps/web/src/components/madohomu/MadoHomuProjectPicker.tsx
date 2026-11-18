import { useAtomValue } from "@effect/atom-react";
import { projectKey } from "@t3tools/client-runtime/state/entities";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, FolderPlusIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import {
  madohomuProjectSelectionPendingAtom,
  madohomuSavedDestinationEnvironmentIdAtom,
  saveMadoHomuProject,
} from "../../madohomu";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { expectsPrimaryEnvironment } from "../../state/shell";
import { resolveEnvironmentOptionLabel } from "../BranchToolbar.logic";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";

type OnProjectChosen = (environmentId: EnvironmentId) => void;

function useProjectPicker(environmentId: EnvironmentId | null, onChosen?: OnProjectChosen) {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const saved = useAtomValue(madohomuSavedDestinationEnvironmentIdAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const pending = useAtomValue(madohomuProjectSelectionPendingAtom);
  const writers = useEnvironmentsWithScope(environments, AuthSettingsWriteScope);
  const creators = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const writable = new Set(
    environments
      .filter((env) => env.connection.phase === "connected" && writers.has(env.environmentId))
      .map((env) => env.environmentId),
  );
  const canSetDestination = primary === null ? !expectsPrimaryEnvironment() : writable.has(primary);
  const canChoose = (id: EnvironmentId) =>
    !pending && writable.has(id) && (id === saved || canSetDestination);
  const machines = new Map(
    environments.map((env) => [
      env.environmentId,
      {
        label: resolveEnvironmentOptionLabel({
          isPrimary: env.environmentId === primary,
          environmentId: env.environmentId,
          runtimeLabel: env.label,
        }),
        kind: resolveEnvironmentMachineKind(env.serverConfig),
      },
    ]),
  );
  const projects = useProjects()
    .filter((project) => project.archivedAt === null && machines.has(project.environmentId))
    .map((project) => ({
      ...project,
      key: projectKey(scopeProjectRef(project.environmentId, project.id)),
      machine: machines.get(project.environmentId)!,
    }));
  const currentId =
    environmentId === null
      ? null
      : (configs.get(environmentId)?.settings.madohomuProjectId ?? null);
  const current = projects.find(
    (project) => project.environmentId === environmentId && project.id === currentId,
  );
  const choose = async (id: EnvironmentId, projectId: ProjectId | null) => {
    try {
      if (await saveMadoHomuProject(id, projectId)) onChosen?.(id);
    } catch (error) {
      toastManager.add({
        type: "error",
        title:
          projectId === null
            ? "Could not clear MadoHomu’s project"
            : "Could not select MadoHomu’s project",
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  };
  const addTargets = environments
    .filter((env) => canChoose(env.environmentId) && creators.has(env.environmentId))
    .map((env) => env.environmentId);
  const newProject = () =>
    openCommandPalette({
      open: "add-project",
      environmentIds: addTargets,
      onProjectAdded: (project) => choose(project.environmentId, project.projectId),
    });
  const clear =
    environmentId !== null && !pending && writable.has(environmentId)
      ? () => void choose(environmentId, null)
      : null;
  return {
    canChoose,
    clear,
    choose,
    current,
    currentId,
    newProject,
    addTargets,
    pending,
    projects,
  };
}

export function MadoHomuProjectPicker({
  environmentId,
  onChosen,
  showNew = true,
}: {
  environmentId: EnvironmentId | null;
  onChosen?: OnProjectChosen;
  showNew?: boolean;
}) {
  const picker = useProjectPicker(environmentId, onChosen);
  return <ProjectPicker picker={picker} showNew={showNew} showClear />;
}

function ProjectPicker({
  picker,
  showNew,
  showClear = false,
}: {
  picker: ReturnType<typeof useProjectPicker>;
  showNew: boolean;
  showClear?: boolean;
}) {
  if (!showNew && picker.projects.length === 0 && (!showClear || picker.currentId === null))
    return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            className="w-full min-w-48 justify-between"
            disabled={picker.pending}
            aria-label="MadoHomu project"
          />
        }
      >
        <span className="min-w-0 truncate">
          {picker.current
            ? `${picker.current.title} · ${picker.current.machine.label}`
            : "Choose a project"}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <ProjectMenuItems picker={picker} showClear={showClear} showNew={showNew} />
      </MenuPopup>
    </Menu>
  );
}

/** Settings and the sidebar share one list of projects and their owning machines. */
export function MadoHomuProjectMenuItems({
  environmentId,
  onChosen,
}: {
  environmentId: EnvironmentId;
  onChosen?: OnProjectChosen;
}) {
  const picker = useProjectPicker(environmentId, onChosen);
  return <ProjectMenuItems picker={picker} />;
}

function ProjectMenuItems({
  picker,
  showClear = false,
  showNew = true,
}: {
  picker: ReturnType<typeof useProjectPicker>;
  showClear?: boolean;
  showNew?: boolean;
}) {
  const { addTargets, canChoose, clear, choose, current, currentId, newProject, projects } = picker;
  return (
    <>
      {showNew && (
        <>
          <MenuItem disabled={addTargets.length === 0} onClick={newProject}>
            <FolderPlusIcon />
            New project…
          </MenuItem>
          {projects.length > 0 && <MenuSeparator />}
        </>
      )}
      <MenuRadioGroup value={current?.key ?? ""}>
        {projects.map((project) => (
          <MenuRadioItem
            key={project.key}
            value={project.key}
            disabled={!canChoose(project.environmentId)}
            onClick={() => void choose(project.environmentId, project.id)}
            closeOnClick
          >
            <span className="flex items-center gap-2">
              <EnvironmentMachineIcon kind={project.machine.kind} aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{project.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {project.machine.label}
                </span>
              </span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {showClear && currentId !== null && (
        <>
          <MenuSeparator />
          <MenuItem disabled={clear === null} onClick={clear ?? undefined}>
            Clear project
          </MenuItem>
        </>
      )}
    </>
  );
}

export function MadoHomuNoProject({
  environmentId,
  message = "Make a new project for MadoHomu to focus on, or choose one you already have.",
}: {
  environmentId: EnvironmentId | null;
  message?: string;
}) {
  const navigate = useNavigate();
  const picker = useProjectPicker(
    environmentId,
    (id) => void navigate({ to: "/madohomu", search: { environmentId: id } }),
  );
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">MadoHomu</h1>
      <p>{message}</p>
      <Button
        className="w-full"
        disabled={picker.addTargets.length === 0}
        onClick={picker.newProject}
      >
        <FolderPlusIcon />
        New project…
      </Button>
      <ProjectPicker picker={picker} showNew={false} />
    </div>
  );
}
