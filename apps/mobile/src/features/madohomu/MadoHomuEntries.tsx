import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { useEnvironments } from "../../state/environments";

export function MadoHomuEntries() {
  const { environments } = useEnvironments();
  const enabled = environments.filter(
    (environment) => environment.serverConfig?.settings.madohomuEnabled,
  );
  if (enabled.length === 0) return null;
  return (
    <View className="px-5">
      {enabled.map((environment) => (
        <ListActionRow
          key={environment.environmentId}
          icon="bubble.left.and.bubble.right"
          label="MadoHomu"
          detail={environment.label}
          onPress={() =>
            rootNavigationRef.navigate("MadoHomu", { environmentId: environment.environmentId })
          }
        />
      ))}
    </View>
  );
}
