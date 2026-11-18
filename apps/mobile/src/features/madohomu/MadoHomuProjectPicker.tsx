import { StackActions, useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useCallback } from "react";
import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { useProjects } from "../../state/entities";
import {
  clearAddProjectCompletion,
  setAddProjectCompletion,
} from "../projects/addProjectCompletion";

/**
 * MadoHomu's project list: "New project" first, which runs the app's add-project flow and
 * comes back here with the new project chosen, then the projects already in the environment.
 */
export function MadoHomuProjectPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly disabled: boolean;
  /** Offers "Clear project"; the screen's own Change project menu leaves it out. */
  readonly allowClear?: boolean;
  readonly onChange: (projectId: ProjectId | null) => void;
}) {
  const navigation = useNavigation();
  const route = useRoute();
  const projects = useProjects().filter(
    (project) => project.environmentId === props.environmentId && project.archivedAt === null,
  );
  // Back here means the add-project flow finished or was abandoned; either way it is done.
  useFocusEffect(useCallback(() => clearAddProjectCompletion(), []));

  const newProject = () => {
    const { onChange, environmentId } = props;
    setAddProjectCompletion((project) => {
      navigation.dispatch(StackActions.popTo(route.name, route.params));
      onChange(project.projectId);
    });
    navigation.dispatch(StackActions.push("AddProject", { environmentId, lockEnvironment: true }));
  };

  return (
    <View className="gap-3">
      <ListActionRow
        icon="folder.badge.plus"
        label="New project"
        disabled={props.disabled}
        onPress={newProject}
      />
      {projects.length > 0 ? (
        <View>
          {projects.map((project) => (
            <ListActionRow
              key={project.id}
              label={project.title}
              icon={props.projectId === project.id ? "checkmark" : undefined}
              detail={props.projectId === project.id ? "Selected" : undefined}
              disabled={props.disabled}
              onPress={() => props.onChange(project.id)}
            />
          ))}
        </View>
      ) : null}
      {props.allowClear !== false && props.projectId !== null ? (
        <ListActionRow
          label="Clear project"
          disabled={props.disabled}
          onPress={() => props.onChange(null)}
        />
      ) : null}
    </View>
  );
}
