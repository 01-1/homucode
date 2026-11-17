import { requireOptionalNativeModule } from "expo";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useEnvironments } from "../../state/environments";
import { madohomuLauncherWanted, type EnvironmentMadoHomuState } from "./madohomuLauncherState";

export function useMadoHomuEnvironmentStates(): EnvironmentMadoHomuState[] {
  const { environments } = useEnvironments();
  return environments.map((environment) => ({
    environmentId: environment.environmentId,
    madohomuEnabled: environment.serverConfig
      ? environment.serverConfig.settings.madohomuEnabled === true
      : undefined,
  }));
}

const launcherModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<{ setEnabled(enabled: boolean): boolean }>("T3MadoHomuLauncher")
    : null;

/** Keeps the Android "MadoHomu" launcher icon in step with the MadoHomu setting. */
export function MadoHomuLauncherSync() {
  const wanted = madohomuLauncherWanted(useMadoHomuEnvironmentStates());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the setting into the native launcher component state
  useEffect(() => {
    if (wanted === undefined || !launcherModule) return;
    try {
      launcherModule.setEnabled(wanted);
    } catch (error) {
      console.warn("[madohomu] could not switch the launcher icon", error);
    }
  }, [wanted]);
  return null;
}
