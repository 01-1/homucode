import { expect, it } from "vite-plus/test";

import {
  createHomeCovers,
  createHomeListOffer,
  homeListCapturable,
  homeListRows,
  launchPictureCanLeave,
  sameHomeListRows,
  type HomeListRow,
} from "./home-launch-snapshot";

const rows: ReadonlyArray<HomeListRow> = [
  { key: "env:thread-1" },
  { key: "env:thread-2" },
  { key: "v2-settled-shelf", count: 935, expanded: false },
];

function list(
  input: { readonly measured?: number; readonly scroll?: number; readonly rowHeight?: number } = {},
) {
  const measured = rows.slice(0, input.measured ?? rows.length);
  const rowHeight = input.rowHeight ?? 72;
  return {
    end: rows.length - 1,
    scroll: input.scroll ?? 0,
    data: rows,
    sizes: new Map(measured.map((row) => [row.key, rowHeight])),
    positionAtIndex: (index: number) => 16 + index * rowHeight,
  };
}

const showing = {
  routeName: "Home",
  routeSettled: true,
  list: list(),
  covered: false,
  keyboardVisible: false,
};

it.each([
  { name: "saves Home's list at its top with rows laid out", input: showing, saves: true },
  { name: "skips another route", input: { ...showing, routeName: "Thread" }, saves: false },
  {
    name: "skips before navigation is ready",
    input: { ...showing, routeName: undefined },
    saves: false,
  },
  {
    name: "skips while a screen slides off Home",
    input: { ...showing, routeSettled: false },
    saves: false,
  },
  { name: "skips when no list has rows", input: { ...showing, list: undefined }, saves: false },
  {
    name: "skips before the list's first layout",
    input: { ...showing, list: { ...list(), end: -1 } },
    saves: false,
  },
  {
    name: "skips while a row on screen is not laid out",
    input: { ...showing, list: list({ measured: 2 }) },
    saves: false,
  },
  {
    name: "skips a scrolled list",
    input: { ...showing, list: list({ scroll: 48 }) },
    saves: false,
  },
  {
    name: "skips an open menu or search field",
    input: { ...showing, covered: true },
    saves: false,
  },
  { name: "skips an open keyboard", input: { ...showing, keyboardVisible: true }, saves: false },
])("$name", ({ input, saves }) => {
  expect(homeListCapturable(input)).toBe(saves);
});

it("names the rows on screen with each shelf's count and open state and every row's place", () => {
  expect(homeListRows(list())).toBe(
    "env:thread-1@16\nenv:thread-2@88\nv2-settled-shelf:935:false@160",
  );
  expect(homeListRows({ ...list(), end: 0 })).toBe("env:thread-1@16");
  // The same rows before the list has moved them to their measured places.
  expect(homeListRows(list({ rowHeight: 80 }))).not.toBe(homeListRows(list()));
});

it("takes rows a point or two apart, or one row at the bottom edge, as the same rows", () => {
  const picture = "a@0\nb@66\nshelf:935:false@131";
  expect(sameHomeListRows("a@0\nb@65\nshelf:935:false@130", picture)).toBe(true);
  expect(sameHomeListRows("a@0\nb@66", picture)).toBe(true);
  expect(sameHomeListRows("a@0\nb@74\nshelf:935:false@139", picture)).toBe(false);
  expect(sameHomeListRows("a@0\nb@66\nshelf:385:false@131", picture)).toBe(false);
  expect(sameHomeListRows("b@0\na@66\nshelf:935:false@131", picture)).toBe(false);
  expect(sameHomeListRows("a@0", picture)).toBe(false);
});

const pictureRows = homeListRows(list());
const matching = {
  shellCachesRead: true,
  rows: pictureRows,
  pictureRows,
  limitReached: false,
};

it.each([
  { name: "leaves when the real list shows the picture's rows", input: matching, leaves: true },
  {
    name: "waits for every environment's cached rows",
    input: { ...matching, shellCachesRead: false },
    leaves: false,
  },
  {
    name: "waits while the rows are not laid out",
    input: { ...matching, rows: undefined },
    leaves: false,
  },
  {
    name: "waits while the list shows other rows",
    input: { ...matching, rows: homeListRows({ ...list(), end: 0 }) },
    leaves: false,
  },
  {
    name: "waits while the rows are not yet where the picture has them",
    input: { ...matching, rows: homeListRows(list({ rowHeight: 80 })) },
    leaves: false,
  },
  {
    name: "leaves at the limit whatever the list shows",
    input: { ...matching, shellCachesRead: false, rows: undefined, limitReached: true },
    leaves: true,
  },
])("$name", ({ input, leaves }) => {
  expect(launchPictureCanLeave(input)).toBe(leaves);
});

it("reads the list offered last and nothing once it is withdrawn", () => {
  const offer = createHomeListOffer();
  expect(offer.read()).toBeUndefined();

  const first = list({ scroll: 1 });
  const second = list({ scroll: 2 });
  const withdrawFirst = offer.offer(() => first);
  const withdrawSecond = offer.offer(() => second);
  // An unmounting list must not withdraw the one that replaced it.
  withdrawFirst();
  expect(offer.read()).toBe(second);

  withdrawSecond();
  expect(offer.read()).toBeUndefined();
});

it("stays covered until every cover is released, each only once", () => {
  const covers = createHomeCovers();
  expect(covers.covered()).toBe(false);

  const releaseSearch = covers.cover();
  const releaseMenu = covers.cover();
  releaseSearch();
  releaseSearch();
  expect(covers.covered()).toBe(true);

  releaseMenu();
  expect(covers.covered()).toBe(false);
});
