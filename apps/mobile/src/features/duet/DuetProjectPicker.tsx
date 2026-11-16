import { type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { useProjects } from "../../state/entities";

export function DuetProjectPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly disabled: boolean;
  readonly onChange: (projectId: ProjectId | null) => void;
}) {
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === props.environmentId &&
      project.archivedAt === null &&
      project.deletedAt === null,
  );
  return (
    <View>
      <ListActionRow
        label="Choose a project"
        detail={props.projectId === null ? "Selected" : undefined}
        disabled={props.disabled}
        onPress={() => props.onChange(null)}
      />
      {projects.map((project) => (
        <ListActionRow
          key={project.id}
          label={project.title}
          detail={props.projectId === project.id ? "Selected" : undefined}
          disabled={props.disabled}
          onPress={() => props.onChange(project.id)}
        />
      ))}
      {projects.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">
          Add a project to this environment first.
        </Text>
      ) : null}
    </View>
  );
}
