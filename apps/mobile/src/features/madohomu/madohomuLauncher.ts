import type { NavigationContainerRef } from "@react-navigation/native";
import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

import { dispatchTaskHardwareBack, type AndroidTaskSurface } from "../../lib/backHandler";
import { attachRootNavigation, focusRootNavigation } from "../../lib/rootNavigation";
import { useEnvironments } from "../../state/environments";
import {
  madohomuLauncherDestinationAction,
  madohomuLauncherWanted,
  type EnvironmentMadoHomuState,
} from "./madohomuLauncherState";

type RootNavigation = NavigationContainerRef<ReactNavigation.RootParamList>;

const launcherModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<{
        setEnabled(enabled: boolean): boolean;
        foregroundSurface(): AndroidTaskSurface;
        completeTaskBack(id: number, handled: boolean): void;
        exitFocusedTask(surface: AndroidTaskSurface): void;
        addListener(
          event: "onForegroundSurfaceChange",
          listener: (event: { surface: AndroidTaskSurface }) => void,
        ): EventSubscription;
        addListener(
          event: "onTaskBackPress",
          listener: (event: { id: number; surface: AndroidTaskSurface }) => void,
        ): EventSubscription;
      }>("T3MadoHomuLauncher")
    : null;

const containers = new Map<AndroidTaskSurface, RootNavigation>();
let foregroundSurface: AndroidTaskSurface = launcherModule?.foregroundSurface() ?? "main";

// A foreground task without a mounted navigator clears the ref, so global navigation queues.
launcherModule?.addListener("onForegroundSurfaceChange", ({ surface }) => {
  foregroundSurface = surface;
  focusRootNavigation(containers.get(surface) ?? null);
});

launcherModule?.addListener("onTaskBackPress", ({ id, surface }) => {
  let handled = false;
  try {
    handled = routeHardwareBack(surface);
  } finally {
    launcherModule.completeTaskBack(id, handled);
  }
});

function attachSurfaceNavigation(surface: AndroidTaskSurface) {
  return (navigation: RootNavigation | null) => {
    const detach = attachRootNavigation(navigation);
    if (!navigation) return detach;
    containers.set(surface, navigation);
    foregroundSurface = launcherModule?.foregroundSurface() ?? foregroundSurface;
    focusRootNavigation(containers.get(foregroundSurface) ?? null);
    return () => {
      if (containers.get(surface) === navigation) containers.delete(surface);
      detach();
      focusRootNavigation(containers.get(foregroundSurface) ?? null);
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

export const hasAndroidTaskRouting = launcherModule !== null;

export function taskNavigationState(surface: AndroidTaskSurface) {
  return containers.get(surface)?.getRootState();
}

export function syncMadoHomuLauncherDestination(environmentId: string) {
  const navigation = containers.get("madohomu");
  const action = madohomuLauncherDestinationAction(navigation?.getRootState(), environmentId);
  if (navigation && action) navigation.dispatch(action);
}

function routeHardwareBack(surface: AndroidTaskSurface): boolean {
  if (dispatchTaskHardwareBack(surface)) return true;
  const navigation = containers.get(surface);
  if (!navigation?.isReady() || !navigation.canGoBack()) return false;
  navigation.goBack();
  return true;
}

export function exitAndroidTask(surface: AndroidTaskSurface | null) {
  if (surface && launcherModule) launcherModule.exitFocusedTask(surface);
  else BackHandler.exitApp();
}
