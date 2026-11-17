/** The picture a cold launch started on: the list rows it shows and how old the launch is. */
export interface ShownLaunchSnapshot {
  readonly rows: string;
  /** Counted from the activity's start, about a quarter second after a cold process starts. */
  readonly sinceLaunchStartMs: number;
}

/**
 * Android shows a saved picture of Home's list in a cold launch's first frame; see
 * `launchSnapshot.android.ts`. Other platforms have no such picture.
 */
export function captureLaunchSnapshot(_rows: string): void {}

export function launchSnapshotShowing(): ShownLaunchSnapshot | null {
  return null;
}

export function hideLaunchSnapshot(): void {}

export function clearLaunchSnapshot(): void {}
