import { minuteTick } from "@t3tools/client-runtime/clock";
import { useSyncExternalStore } from "react";

export function useNowMinute(): string {
  return useSyncExternalStore(minuteTick.subscribe, minuteTick.getSnapshot, minuteTick.getSnapshot);
}

/** The current minute as a timestamp. */
export function useNowMinuteMs(): number {
  return Date.parse(`${useNowMinute()}:00Z`);
}
