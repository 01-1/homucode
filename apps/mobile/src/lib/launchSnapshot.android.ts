import { requireOptionalNativeModule } from "expo";

import type { ShownLaunchSnapshot } from "./launchSnapshot";

const native = requireOptionalNativeModule<{
  capture(rows: string): void;
  showing(): ShownLaunchSnapshot | null;
  hide(): void;
  clear(): void;
}>("T3LaunchSnapshot");

/**
 * Saves a picture of the window. Call it only while Home's list is all the window shows, with
 * a name for its rows that the next launch can compare its own list to.
 */
export function captureLaunchSnapshot(rows: string): void {
  native?.capture(rows);
}

/** The picture this cold launch started on, while it is still up. */
export function launchSnapshotShowing(): ShownLaunchSnapshot | null {
  return native?.showing() ?? null;
}

/** Removes the picture a cold launch started with, now that the real screen is drawn. */
export function hideLaunchSnapshot(): void {
  native?.hide();
}

/** Deletes the saved picture. It shows thread titles, so it must not outlive their data. */
export function clearLaunchSnapshot(): void {
  native?.clear();
}
