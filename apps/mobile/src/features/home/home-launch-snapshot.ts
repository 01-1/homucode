import type { Preferences } from "../../persistence/mobile-preferences";

const HOME_LOOK_PREFERENCES = [
  "themeId",
  "lightThemeId",
  "darkThemeId",
  "themeMode",
  "baseFontSize",
  "language",
  "androidNavigationStyle",
  "navigationTabOrder",
  "hiddenNavigationTabs",
  "projectGroupingEnabled",
  "projectGroupingMode",
  "workingShelfEnabled",
  "sidebarKeepWatchingPullRequests",
  "threadListSettledShelfExpanded",
  "threadListSnoozedShelfExpanded",
  "threadListWorkingShelfExpanded",
  "threadListFilters",
] as const satisfies ReadonlyArray<keyof Preferences>;

/**
 * Names the saved preferences Home's first screen is drawn from: its colours, text, bars and
 * which threads it lists. A picture saved under another name is not what a launch would draw.
 */
export function homeLook(preferences: Preferences): string {
  return JSON.stringify(HOME_LOOK_PREFERENCES.map((key) => preferences[key] ?? null));
}

/** A row of the list. Shelf rows also carry their count and whether they are open. */
export interface HomeListRow {
  readonly key: string;
  readonly count?: number;
  readonly expanded?: boolean;
}

/** The parts of the list's own state that say which rows are on screen and laid out. */
export interface HomeListState {
  /** Index of the last row on screen; negative before the first layout. */
  readonly end: number;
  readonly scroll: number;
  readonly data: ReadonlyArray<HomeListRow>;
  /** Measured row heights by row key. A row the list has not laid out yet has none. */
  readonly sizes: ReadonlyMap<string, number>;
  /** Where the list has put a row, from the top of its content. */
  readonly positionAtIndex: (index: number) => number | undefined;
}

function rowsOnScreen(list: HomeListState): ReadonlyArray<HomeListRow> {
  return list.data.slice(0, list.end + 1);
}

/** Whether every row on screen is laid out. */
export function homeListLaidOut(list: HomeListState): boolean {
  return list.end >= 0 && rowsOnScreen(list).every((row) => list.sizes.has(row.key));
}

/**
 * Names the rows on screen in order: each shelf's count and whether it is open, and where every
 * row sits. Two lists with the same name show the same threads, grouped and placed the same. The
 * list moves rows after it first measures them, so the places are part of the name.
 */
export function homeListRows(list: HomeListState): string {
  return rowsOnScreen(list)
    .map((row, index) => {
      const name = row.count === undefined ? row.key : `${row.key}:${row.count}:${row.expanded}`;
      return `${name}@${Math.round(list.positionAtIndex(index) ?? -1)}`;
    })
    .join("\n");
}

// Measured heights differ by a fraction of a point from one launch to the next, which can move
// a rounded place by one, and can bring the row at the screen's bottom edge in or out of view.
const PLACE_TOLERANCE = 2;

/** Whether two names from `homeListRows` describe the same rows in the same places. */
export function sameHomeListRows(a: string, b: string): boolean {
  const rowsA = a.split("\n");
  const rowsB = b.split("\n");
  if (Math.abs(rowsA.length - rowsB.length) > 1) return false;
  return rowsA.slice(0, rowsB.length).every((row, index) => {
    const other = rowsB[index] ?? "";
    const at = row.lastIndexOf("@");
    const otherAt = other.lastIndexOf("@");
    const apart = Math.abs(Number(row.slice(at + 1)) - Number(other.slice(otherAt + 1)));
    return row.slice(0, at) === other.slice(0, otherAt) && apart <= PLACE_TOLERANCE;
  });
}

/**
 * Home's list, while it has rows a cold launch would also start with. The launch picture is
 * taken outside React, so the list offers a way to read its state at that moment.
 */
export function createHomeListOffer() {
  let offered: (() => HomeListState | undefined) | null = null;
  return {
    /** Call the returned withdrawal when the list no longer shows those rows or unmounts. */
    offer: (read: () => HomeListState | undefined) => {
      offered = read;
      return () => {
        if (offered === read) offered = null;
      };
    },
    read: () => offered?.(),
  };
}

const homeList = createHomeListOffer();

export const offerHomeListToLaunchSnapshot = homeList.offer;
export const offeredHomeList = homeList.read;

/**
 * Things drawn in Home's window that a cold launch does not start with, such as an open search
 * field. Each holds a cover while it shows.
 */
export function createHomeCovers() {
  let covers = 0;
  return {
    /** Call the returned release when the thing is gone. */
    cover: () => {
      let held = true;
      covers += 1;
      return () => {
        if (!held) return;
        held = false;
        covers -= 1;
      };
    },
    covered: () => covers > 0,
  };
}

const homeCovers = createHomeCovers();

export const coverHomeForLaunchSnapshot = homeCovers.cover;
export const homeCoveredForLaunchSnapshot = homeCovers.covered;

/**
 * Whether the window shows what a cold launch starts with: Home's list at its top, with its
 * rows laid out and nothing drawn over it. Only then is a picture of the window worth saving.
 */
export function homeListCapturable(input: {
  readonly routeName: string | undefined;
  /** False while a screen may still be sliding over Home or off it. */
  readonly routeSettled: boolean;
  readonly list: HomeListState | undefined;
  readonly covered: boolean;
  readonly keyboardVisible: boolean;
}): boolean {
  if (input.routeName !== "Home" || !input.routeSettled) return false;
  if (input.covered || input.keyboardVisible) return false;
  return input.list !== undefined && homeListLaidOut(input.list) && input.list.scroll <= 0;
}

/**
 * Whether the picture a cold launch started on can leave: the real list shows the picture's
 * rows, so nothing changes on screen. The list fills in over several renders as each
 * environment's caches are read, and any of those can look settled for a while, so a list that
 * has changed since the picture waits for the limit.
 */
export function launchPictureCanLeave(input: {
  readonly shellCachesRead: boolean;
  /** The rows on screen, once they are laid out. */
  readonly rows: string | undefined;
  readonly pictureRows: string;
  readonly limitReached: boolean;
}): boolean {
  if (input.limitReached) return true;
  if (!input.shellCachesRead || input.rows === undefined) return false;
  return sameHomeListRows(input.rows, input.pictureRows);
}
