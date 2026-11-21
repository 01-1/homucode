import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform, View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
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

export function MadoHomuHomeEntries() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const showAndroidRow =
    AsyncResult.isSuccess(preferences) && preferences.value.showAndroidMadoHomuHomeRow === true;
  if (Platform.OS === "android" && !showAndroidRow) return null;
  return <MadoHomuEntries />;
}

export function MadoHomuEntries() {
  const { hasNavigationRail } = useAdaptiveWorkspaceLayout();
  const enabled = useMadoHomuEnvironments();
  if (hasNavigationRail || enabled.length === 0) return null;
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
