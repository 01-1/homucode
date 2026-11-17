import { AppState, Keyboard, Platform } from "react-native";

import { overlayPortalOpen } from "../../components/ui/OverlayPortal";
import {
  captureLaunchSnapshot,
  hideLaunchSnapshot,
  launchSnapshotShowing,
} from "../../lib/launchSnapshot";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { appAtomRegistry } from "../../state/atom-registry";
import { shellCachesReadAtom } from "../../state/shell";
import {
  homeCoveredForLaunchSnapshot,
  homeListCapturable,
  homeListLaidOut,
  homeListRows,
  launchPictureCanLeave,
  offeredHomeList,
} from "./home-launch-snapshot";

// The cached rows take their first server updates in this time. Every later background saves
// the picture again, so this only covers a launch that never reaches one with Home showing.
const LAUNCH_SETTLE_MS = 2_500;
// A screen sliding over Home, or off it, is still on screen for this long after the route changes.
const ROUTE_SETTLE_MS = 700;
// From the activity's start: about five seconds after a cold process starts. The picture already
// shows the list, so it waits for the real rows past the splash's own limit, but not for a list
// that never shows them.
const PICTURE_LIMIT_MS = 4_750;

let routeChangedAt = 0;

function captureHomeList(): void {
  const state = rootNavigationRef.isReady() ? rootNavigationRef.getRootState() : undefined;
  const list = offeredHomeList();
  const capturable = homeListCapturable({
    routeName: state?.routes[state.index]?.name,
    routeSettled: Date.now() - routeChangedAt >= ROUTE_SETTLE_MS,
    list,
    covered: overlayPortalOpen() || homeCoveredForLaunchSnapshot(),
    keyboardVisible: Keyboard.isVisible(),
  });
  if (capturable && list !== undefined) captureLaunchSnapshot(homeListRows(list));
}

function finishLaunch(): void {
  hideLaunchSnapshot();
  setTimeout(() => {
    if (AppState.currentState === "active") captureHomeList();
  }, LAUNCH_SETTLE_MS);
}

/**
 * Called when the splash would hide. A launch that started on the saved picture keeps it until
 * the real list shows the same rows, or until the limit; any other launch has nothing to wait
 * for. Either way a new picture is saved once the launch settles.
 */
export function handOverLaunchSnapshot(): void {
  if (Platform.OS !== "android") return;
  const picture = launchSnapshotShowing();
  if (picture === null) {
    finishLaunch();
    return;
  }
  const limitAt = Date.now() + Math.max(0, PICTURE_LIMIT_MS - picture.sinceLaunchStartMs);
  // The list lays its rows out outside React, so its state is read once a frame until it is ready.
  const check = () => {
    const list = offeredHomeList();
    const leave = launchPictureCanLeave({
      shellCachesRead: appAtomRegistry.get(shellCachesReadAtom),
      rows: list !== undefined && homeListLaidOut(list) ? homeListRows(list) : undefined,
      pictureRows: picture.rows,
      limitReached: Date.now() >= limitAt,
    });
    if (leave) finishLaunch();
    else requestAnimationFrame(check);
  };
  check();
}

/** Saves the picture when the app leaves the foreground, so it is the last list the user saw. */
export function installLaunchSnapshotCapture(): () => void {
  if (Platform.OS !== "android") return () => {};
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") captureHomeList();
  });
  const unsubscribeRoutes = rootNavigationRef.addListener("state", () => {
    routeChangedAt = Date.now();
  });
  return () => {
    subscription.remove();
    unsubscribeRoutes();
  };
}
