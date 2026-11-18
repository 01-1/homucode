import { useIsFocused } from "@react-navigation/native";
import { createContext, useContext, useEffect, useEffectEvent } from "react";
import { BackHandler } from "react-native";

import { usePaneRole } from "../components/ui/Pane";

export type AndroidTaskSurface = "main" | "madohomu";

export const AndroidTaskSurfaceContext = createContext<AndroidTaskSurface | null>(null);

const taskHandlers = {
  main: new Set<() => boolean>(),
  madohomu: new Set<() => boolean>(),
};

export function registerTaskHardwareBack(surface: AndroidTaskSurface, handler: () => boolean) {
  taskHandlers[surface].add(handler);
  return () => {
    taskHandlers[surface].delete(handler);
  };
}

export function dispatchTaskHardwareBack(surface: AndroidTaskSurface): boolean {
  return [...taskHandlers[surface]].reverse().some((handler) => handler());
}

/** Registers a screen handler ahead of the navigator fallback in its own Android task. */
export function useTaskHardwareBack(active: boolean, onBack: () => boolean) {
  const surface = useContext(AndroidTaskSurfaceContext);
  const handleBack = useEffectEvent(onBack);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the active screen to its own task's Back event
  useEffect(() => {
    if (!active) return;
    const handler = () => handleBack();
    if (!surface) {
      const subscription = BackHandler.addEventListener("hardwareBackPress", handler);
      return () => subscription.remove();
    }
    return registerTaskHardwareBack(surface, handler);
  }, [active, surface]);
}

/**
 * Android hardware back while `active` and the owning screen is focused.
 * Keyed on those alone, not `onBack`: BackHandler calls the newest listener
 * first, so re-registering per render lets a covered screen consume Back.
 */
export function useHardwareBack(active: boolean, onBack: () => boolean) {
  // The sidebar's route stays unfocused under the page beside it.
  const inSidebar = usePaneRole() === "sidebar";
  const focused = useIsFocused() || inSidebar;
  useTaskHardwareBack(active && focused, onBack);
}
