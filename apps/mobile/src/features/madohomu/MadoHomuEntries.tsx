import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { useEnvironments } from "../../state/environments";

export function useMadoHomuEnvironments() {
  const { environments } = useEnvironments();
  return environments.filter((environment) => environment.serverConfig?.settings.madohomuEnabled);
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
