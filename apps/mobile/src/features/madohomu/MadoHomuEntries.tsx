import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { madoHomuEntryEnvironments } from "./madohomuDestination";
import { useMadoHomuDestination } from "./useMadoHomuDestination";

export function useMadoHomuEnvironments() {
  const { candidates, linked, primaryEnvironmentId } = useMadoHomuDestination();
  const destinations = madoHomuEntryEnvironments(candidates, primaryEnvironmentId);
  return linked.filter((environment) => destinations.includes(environment.environmentId));
}

export function openMadoHomu(environmentId: string) {
  rootNavigationRef.navigate("MadoHomu", { environmentId });
}

export function MadoHomuEntries() {
  const enabled = useMadoHomuEnvironments();
  if (enabled.length === 0) return null;
  return (
    <View className="px-5">
      {enabled.map((environment) => (
        <ListActionRow
          key={environment.environmentId}
          icon="bubble.left.and.bubble.right"
          label="MadoHomu"
          detail={environment.label}
          onPress={() => openMadoHomu(environment.environmentId)}
        />
      ))}
    </View>
  );
}
