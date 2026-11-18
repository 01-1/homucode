import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { useMadoHomuDestination } from "./useMadoHomuDestination";

export function useMadoHomuEnvironments() {
  const { destination, linked } = useMadoHomuDestination();
  return linked.filter(
    (environment) =>
      environment.environmentId === destination.environmentId &&
      environment.serverConfig?.settings.madohomuEnabled !== false,
  );
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
