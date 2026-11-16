import { View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { useEnvironments } from "../../state/environments";

export function DuetEntries() {
  const { environments } = useEnvironments();
  const enabled = environments.filter(
    (environment) => environment.serverConfig?.settings.duetEnabled,
  );
  if (enabled.length === 0) return null;
  return (
    <View className="px-5">
      {enabled.map((environment) => (
        <ListActionRow
          key={environment.environmentId}
          icon="bubble.left.and.bubble.right"
          label="Duet"
          detail={environment.label}
          onPress={() =>
            rootNavigationRef.navigate("Duet", { environmentId: environment.environmentId })
          }
        />
      ))}
    </View>
  );
}
