import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronsUpDownIcon, FolderPlusIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { useMadoHomuActions } from "./useMadoHomuActions";

/**
 * Opens T3 Code's own add-project flow (new folder, existing folder, clone) and makes
 * the project it ends on MadoHomu's project, instead of opening a thread in it.
 */
function useNewMadoHomuProject(environmentId: EnvironmentId) {
  const { changeProject } = useMadoHomuActions(environmentId);
  return () =>
    openCommandPalette({
      open: "add-project",
      environmentId,
      onProjectAdded: (project) => {
        if (project.environmentId !== environmentId) {
          toastManager.add({
            type: "warning",
            title: "Project added on another environment",
            description: "MadoHomu stays on its own environment, so it kept its project.",
          });
          return;
        }
        void changeProject(project.projectId);
      },
    });
}

export function MadoHomuProjectPicker({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const newProject = useNewMadoHomuProject(environmentId);
  const projects = useProjects().filter(
    (p) => p.environmentId === environmentId && p.archivedAt === null,
  );
  const current = projects.find((p) => p.id === actions.settings.madohomuProjectId);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            className="w-full min-w-48 justify-between"
            disabled={!actions.canWrite}
            aria-label="MadoHomu project"
          />
        }
      >
        <span className="min-w-0 truncate">{current?.title ?? "Choose a project"}</span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem onClick={newProject}>
          <FolderPlusIcon />
          New project…
        </MenuItem>
        {projects.length > 0 && <MenuSeparator />}
        <MenuRadioGroup
          value={current?.id ?? ""}
          onValueChange={(value) => {
            const project = projects.find((p) => p.id === value);
            if (project) void actions.changeProject(project.id);
          }}
        >
          {projects.map((p) => (
            <MenuRadioItem key={p.id} value={p.id} closeOnClick>
              {p.title}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {actions.settings.madohomuProjectId !== null && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => void actions.changeProject(null)}>Clear project</MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

export function MadoHomuNoProject({ environmentId }: { environmentId: EnvironmentId }) {
  const { canWrite } = useMadoHomuActions(environmentId);
  const newProject = useNewMadoHomuProject(environmentId);
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">MadoHomu</h1>
      <p>Make a new project for MadoHomu to focus on, or choose one you already have.</p>
      <Button className="w-full" disabled={!canWrite} onClick={newProject}>
        <FolderPlusIcon />
        New project…
      </Button>
      <MadoHomuProjectPicker environmentId={environmentId} />
    </div>
  );
}
