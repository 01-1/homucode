import type { NavigationContainerRef } from "@react-navigation/native";
import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

import { attachRootNavigation, focusRootNavigation } from "../../lib/rootNavigation";
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
const attachListeners = new Set<() => void>();
let foregroundSurface: Surface = launcherModule?.foregroundSurface() ?? "main";

// A foreground task without a mounted navigator clears the ref, so global navigation queues.
launcherModule?.addListener("onForegroundSurfaceChange", ({ surface }) => {
  foregroundSurface = surface;
  focusRootNavigation(containers.get(surface) ?? null);
});

function attachSurfaceNavigation(surface: Surface) {
  return (navigation: RootNavigation | null) => {
    const detach = attachRootNavigation(navigation);
    if (!navigation) return detach;
    containers.set(surface, navigation);
    foregroundSurface = launcherModule?.foregroundSurface() ?? foregroundSurface;
    focusRootNavigation(containers.get(foregroundSurface) ?? null);
    for (const listener of attachListeners) listener();
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

function routeHardwareBack(): boolean {
  const navigation = containers.get(foregroundSurface);
  const canGoBack = navigation?.isReady() === true && navigation.canGoBack();
  // The main task keeps its own Back chain; only its root exit must not reach the MadoHomu stack.
  if (foregroundSurface === "main" && canGoBack) return false;
  if (canGoBack) navigation!.goBack();
  else BackHandler.exitApp();
  return true;
}

/**
 * Both roots' navigators share one hardware Back event, newest listener first. This re-registers
 * after every navigator attaches so it runs before both and routes Back to the foreground task.
 */
export function MadoHomuBackRouting() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the native hardware Back event
  useEffect(() => {
    let subscription = BackHandler.addEventListener("hardwareBackPress", routeHardwareBack);
    const reRegister = () => {
      subscription.remove();
      subscription = BackHandler.addEventListener("hardwareBackPress", routeHardwareBack);
    };
    attachListeners.add(reRegister);
    return () => {
      attachListeners.delete(reRegister);
      subscription.remove();
    };
  }, []);
  return null;
}
