import { StackActions, useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { useCallback } from "react";
import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { useProjects } from "../../state/entities";
import type { EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentsWithScope } from "../../state/session";
import {
  clearAddProjectCompletion,
  setAddProjectCompletion,
} from "../projects/addProjectCompletion";

/** The add-project flow returns here with the new project's owning environment. */
export function MadoHomuProjectPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly environments: readonly EnvironmentPresentation[];
  readonly selectionIssue: (environmentId: EnvironmentId) => string | null;
  readonly disabled: boolean;
  readonly canClear: boolean;
  readonly onChange: (project: ScopedProjectRef | null) => void;
}) {
  const navigation = useNavigation();
  const route = useRoute();
  const environmentById = new Map(
    props.environments.map((environment) => [environment.environmentId, environment]),
  );
  const currentEnvironment = useEnvironmentPresentation(props.environmentId).presentation;
  const isSelected = (project: { environmentId: EnvironmentId; id: ProjectId }) =>
    props.environmentId === project.environmentId && props.projectId === project.id;
  const projects = useProjects().filter(
    (project) =>
      project.archivedAt === null &&
      (environmentById.has(project.environmentId) || isSelected(project)),
  );
  const canCreate = useEnvironmentsWithScope(props.environments, AuthOrchestrationOperateScope);
  // Back here means the add-project flow finished or was abandoned.
  useFocusEffect(useCallback(() => clearAddProjectCompletion(), []));

  const newProject = (environmentId: EnvironmentId) => {
    const { onChange } = props;
    setAddProjectCompletion((project) => {
      navigation.dispatch(StackActions.popTo(route.name, route.params));
      onChange(project);
    });
    navigation.dispatch(StackActions.push("AddProject", { environmentId, lockEnvironment: true }));
  };

  return (
    <View className="gap-3">
      {props.environments
        .filter((environment) => canCreate.has(environment.environmentId))
        .map((environment) => {
          const issue = props.selectionIssue(environment.environmentId);
          return (
            <ListActionRow
              key={environment.environmentId}
              icon="folder.badge.plus"
              label="New project"
              description={issue ? `${environment.label} · ${issue}` : environment.label}
              disabled={props.disabled || issue !== null}
              onPress={() => newProject(environment.environmentId)}
            />
          );
        })}
      {projects.length > 0 ? (
        <View>
          {projects.map((project) => {
            const selected = isSelected(project);
            const issue = props.selectionIssue(project.environmentId);
            const label =
              environmentById.get(project.environmentId)?.label ??
              currentEnvironment?.entry.target.label;
            return (
              <ListActionRow
                key={scopedProjectKey(project.environmentId, project.id)}
                label={project.title}
                description={[label, issue].filter(Boolean).join(" · ")}
                icon={selected ? "checkmark" : undefined}
                detail={selected ? "Selected" : undefined}
                disabled={props.disabled || issue !== null}
                onPress={() =>
                  props.onChange({ environmentId: project.environmentId, projectId: project.id })
                }
              />
            );
          })}
        </View>
      ) : null}
      {props.canClear && props.projectId !== null ? (
        <ListActionRow
          label="Clear project"
          disabled={props.disabled}
          onPress={() => props.onChange(null)}
        />
      ) : null}
    </View>
  );
}
