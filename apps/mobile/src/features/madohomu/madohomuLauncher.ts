import type { NavigationContainerRef } from "@react-navigation/native";
import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

import {
  attachRootNavigation,
  focusRootNavigation,
  rootNavigationRef,
} from "../../lib/rootNavigation";
import { useEnvironments } from "../../state/environments";
import { madohomuLauncherWanted, type EnvironmentMadoHomuState } from "./madohomuLauncherState";

type Surface = "main" | "madohomu";
type RootNavigation = NavigationContainerRef<ReactNavigation.RootParamList>;

const launcherModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<{
        setEnabled(enabled: boolean): boolean;
        foregroundSurface(): Surface;
        addListener(
          event: "onForegroundSurfaceChange",
          listener: (event: { surface: Surface }) => void,
        ): EventSubscription;
      }>("T3MadoHomuLauncher")
    : null;

const containers = new Map<Surface, RootNavigation>();

launcherModule?.addListener("onForegroundSurfaceChange", ({ surface }) => {
  const navigation = containers.get(surface);
  if (navigation) focusRootNavigation(navigation);
});

function attachSurfaceNavigation(surface: Surface) {
  return (navigation: RootNavigation | null) => {
    const detach = attachRootNavigation(navigation);
    if (!navigation) return detach;
    containers.set(surface, navigation);
    const foreground = containers.get(launcherModule?.foregroundSurface() ?? "main");
    if (foreground) focusRootNavigation(foreground);
    return () => {
      if (containers.get(surface) === navigation) containers.delete(surface);
      detach();
    };
  };
}

export const attachMainNavigation = attachSurfaceNavigation("main");
export const attachMadoHomuNavigation = attachSurfaceNavigation("madohomu");

export function useMadoHomuEnvironmentStates(): {
  environments: EnvironmentMadoHomuState[];
  isReady: boolean;
} {
  const { environments, isReady } = useEnvironments();
  return {
    isReady,
    environments: environments.map((environment) => ({
      environmentId: environment.environmentId,
      madohomuEnabled: environment.serverConfig
        ? environment.serverConfig.settings.madohomuEnabled === true
        : undefined,
    })),
  };
}

export function MadoHomuLauncherSync() {
  const { environments, isReady } = useMadoHomuEnvironmentStates();
  const wanted = madohomuLauncherWanted(environments, isReady);
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

/**
 * Both roots' navigators listen to the one shared hardware Back event. Mounted after the
 * MadoHomu navigator, this runs first and sends Back only to the foreground task's navigator.
 */
export function MadoHomuBackRouting() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the native hardware Back event
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (rootNavigationRef.isReady() && rootNavigationRef.canGoBack()) {
        rootNavigationRef.goBack();
      } else {
        BackHandler.exitApp();
      }
      return true;
    });
    return () => subscription.remove();
  }, []);
  return null;
}
