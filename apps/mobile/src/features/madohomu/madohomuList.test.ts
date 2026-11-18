import { ThreadId, type ServerSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import {
  buildMadoHomuListRows,
  dropMadoHomuThread,
  madohomuPlacePatch,
  moveMadoHomuThread,
} from "./madohomuList";

const NOW = "2026-06-02T00:00:00.000Z";
const a = ThreadId.make("a");
const b = ThreadId.make("b");
const c = ThreadId.make("c");
const s = ThreadId.make("s");

const threads = [
  makeThreadShellFixture({ id: a, title: "A", updatedAt: "2026-06-01T03:00:00.000Z" }),
  makeThreadShellFixture({ id: b, title: "B", updatedAt: "2026-06-01T02:00:00.000Z" }),
  makeThreadShellFixture({ id: c, title: "C", updatedAt: "2026-06-01T01:00:00.000Z" }),
  makeThreadShellFixture({ id: s, title: "S", updatedAt: "2026-06-01T04:00:00.000Z" }),
];

const settings: Pick<
  ServerSettings,
  "madohomuThreads" | "madohomuSections" | "madohomuThreadOrder" | "madohomuWorkingPlacement"
> = {
  madohomuThreads: {
    [a]: { icon: null, prompt: "", pinned: true },
    [b]: { icon: null, prompt: "", pinned: true },
    [c]: { icon: null, prompt: "", pinned: true, section: "work" },
  },
  madohomuSections: [
    { id: "work", name: "Work" },
    { id: "empty", name: "Empty" },
  ],
  madohomuThreadOrder: [b, a, c],
  madohomuWorkingPlacement: "section",
};

const summary = (rows: ReturnType<typeof buildMadoHomuListRows>) =>
  rows.map((row) =>
    row.type === "thread" ? row.row.item.thread.id : `${row.type}:${row.key.split(":")[1]}`,
  );

const localSettled = {
  unloadedSettledCount: 0,
  settledLimit: 10,
  isListedSettled: () => true,
};

describe("buildMadoHomuListRows", () => {
  it("lists every section in order, keeps empty custom sections and hides empty Scratch", () => {
    const rows = buildMadoHomuListRows({
      ...localSettled,
      threads,
      settings,
      now: NOW,
      toggled: new Set(),
    });
    expect(summary(rows)).toEqual([
      "section:pinned",
      b,
      a,
      "section:work",
      c,
      "section:empty",
      "empty:empty",
      "section:scratch",
      s,
    ]);
    const pinnedRows = rows.filter((row) => row.type === "thread" && row.kind === "pinned");
    expect(
      pinnedRows.map((row) => row.type === "thread" && [row.canMoveUp, row.canMoveDown]),
    ).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it("counts unloaded Settled threads and lists only the available page when expanded", () => {
    const below = ThreadId.make("below");
    const options = {
      threads,
      settings,
      now: NOW,
      unloadedSettledCount: 40,
      settledLimit: 1,
      isListedSettled: (thread: (typeof threads)[number]) => thread.id !== below,
    };
    const collapsed = buildMadoHomuListRows({ ...options, toggled: new Set() });
    expect(collapsed.at(-1)).toMatchObject({ kind: "settled", count: 40, expanded: false });
    const loading = buildMadoHomuListRows({ ...options, toggled: new Set(["settled"]) });
    expect(summary(loading).slice(-2)).toEqual(["section:settled", "more:settled"]);

    const settled = ["shown", "next", "below"].map((id, index) =>
      makeThreadShellFixture({
        id: ThreadId.make(id),
        settledAt: `2026-06-01T0${3 - index}:00:00.000Z`,
        settledOverride: "settled",
      }),
    );
    const open = buildMadoHomuListRows({
      ...options,
      threads: [...threads, ...settled],
      toggled: new Set(["settled"]),
      unloadedSettledCount: 37,
    });
    expect(summary(open).slice(-3)).toEqual(["section:settled", "shown", "more:settled"]);
    expect(open.at(-3)).toMatchObject({ count: 40, expanded: true });
    expect(open.at(-1)).toMatchObject({ kind: "settled", count: 39 });
    const more = buildMadoHomuListRows({
      ...options,
      threads: [...threads, ...settled],
      toggled: new Set(["settled"]),
      settledLimit: 25,
      unloadedSettledCount: 37,
    });
    expect(summary(more).slice(-4)).toEqual(["section:settled", "shown", "next", "more:settled"]);
    const all = buildMadoHomuListRows({
      ...options,
      threads: [...threads, ...settled],
      toggled: new Set(["settled"]),
      settledLimit: 25,
      isListedSettled: () => true,
      unloadedSettledCount: 0,
    });
    expect(summary(all).slice(-4)).toEqual(["section:settled", "shown", "next", "below"]);
  });

  it("collapses any section, counting the rows that need the user, except in Reorder mode", () => {
    const asking = threads.map((thread) =>
      thread.id === b
        ? { ...thread, hasPendingApprovals: true }
        : thread.id === a
          ? { ...thread, pendingSubagentRequest: "approval" as const }
          : thread.id === c
            ? { ...thread, pendingGuestMessageCount: 1 }
            : thread,
    );
    const rows = buildMadoHomuListRows({
      ...localSettled,
      threads: asking,
      settings,
      now: NOW,
      toggled: new Set(["pinned", "work"]),
    });
    expect(summary(rows).slice(0, 2)).toEqual(["section:pinned", "section:work"]);
    expect(rows[0]).toMatchObject({ expanded: false, attention: 2 });
    expect(rows[1]).toMatchObject({ expanded: false, attention: 1 });
    const reorder = buildMadoHomuListRows({
      ...localSettled,
      threads: asking,
      settings,
      now: NOW,
      toggled: new Set(["pinned"]),
      keepManualOpen: true,
    });
    expect(summary(reorder).slice(0, 3)).toEqual(["section:pinned", b, a]);
    expect(reorder[0]).toMatchObject({ expanded: null, attention: 0 });
  });

  it("pages Scratch but keeps every row that needs the user", () => {
    const scratch = Array.from({ length: 6 }, (_, index) =>
      makeThreadShellFixture({
        id: ThreadId.make(`x${index}`),
        title: `X${index}`,
        latestUserMessageAt: `2026-06-01T0${9 - index}:00:00.000Z`,
        latestUserAuthoredMessageAt: `2026-06-01T0${9 - index}:00:00.000Z`,
        hasPendingUserInput: index === 4,
        pendingSubagentRequest: index === 3 ? "user_input" : null,
        pendingGuestMessageCount: index === 5 ? 1 : 0,
      }),
    );
    const rows = buildMadoHomuListRows({
      ...localSettled,
      threads: [...threads.slice(0, 3), ...scratch],
      settings,
      now: NOW,
      toggled: new Set(),
      scratchCount: 2,
    });
    const ids = summary(rows);
    expect(ids.slice(ids.indexOf("section:scratch"))).toEqual([
      "section:scratch",
      "x0",
      "x1",
      "x3",
      "x4",
      "x5",
      "more:scratch",
    ]);
    expect(rows.at(-1)).toMatchObject({ type: "more", count: 1 });
  });

  it("says nothing pinned in an empty Pinned section", () => {
    const rows = buildMadoHomuListRows({
      ...localSettled,
      threads: threads.filter((thread) => thread.id === s),
      settings: { ...settings, madohomuThreads: {}, madohomuThreadOrder: [] },
      now: NOW,
      toggled: new Set(),
    });
    expect(summary(rows)).toEqual([
      "section:pinned",
      "empty:pinned",
      "section:work",
      "empty:work",
      "section:empty",
      "empty:empty",
      "section:scratch",
      s,
    ]);
  });

  it("never files a thread waiting on the user, a guest included, under Working", () => {
    const w = ThreadId.make("w");
    const g = ThreadId.make("g");
    const rows = buildMadoHomuListRows({
      ...localSettled,
      threads: [
        ...threads,
        makeThreadShellFixture({ id: w, title: "W" }),
        // pendingGuestMessageCount makes the row read "Request".
        ...threads
          .filter((thread) => thread.id === s)
          .map((thread) => ({ ...thread, id: g, pendingGuestMessageCount: 1 })),
      ],
      settings,
      now: NOW,
      toggled: new Set(),
      isWorking: (thread) => thread.id === w || thread.id === g,
    });
    const ids = summary(rows);
    expect(ids.slice(ids.indexOf("section:working"))).toEqual([
      "section:working",
      w,
      "section:scratch",
      g,
      s,
    ]);
  });
});

describe("madohomuPlacePatch", () => {
  it("files a moved thread at the end of its new section and keeps an unmoved one in place", () => {
    expect(madohomuPlacePatch(settings, a, { section: "work" })).toEqual({
      madohomuThreads: { [a]: { icon: null, prompt: "", pinned: true, section: "work" } },
      madohomuThreadOrder: [b, c, a],
    });
    expect(madohomuPlacePatch(settings, s, { section: null })).toEqual({
      madohomuThreads: { [s]: { icon: null, prompt: "", pinned: true, section: null } },
      madohomuThreadOrder: [b, a, c, s],
    });
    expect(madohomuPlacePatch(settings, c, { section: "work" })).toEqual({
      madohomuThreads: { [c]: { icon: null, prompt: "", pinned: true, section: "work" } },
    });
    expect(madohomuPlacePatch(settings, a, null)).toEqual({
      madohomuThreads: { [a]: { icon: null, prompt: "", pinned: false, section: null } },
    });
  });
});

describe("moveMadoHomuThread", () => {
  it("moves a pinned thread within its section", () => {
    expect(
      moveMadoHomuThread({ threads, settings, now: NOW, threadId: a, direction: "up" }),
    ).toEqual([a, b, c]);
    expect(
      moveMadoHomuThread({ threads, settings, now: NOW, threadId: b, direction: "down" }),
    ).toEqual([a, b, c]);
  });

  it("keeps the saved position of a pinned thread that is snoozed", () => {
    const x = ThreadId.make("x");
    const snoozed = makeThreadShellFixture({
      id: x,
      title: "X",
      snoozedUntil: "2026-06-03T00:00:00.000Z",
    });
    expect(
      moveMadoHomuThread({
        threads: [...threads, snoozed],
        settings: {
          ...settings,
          madohomuThreads: { ...settings.madohomuThreads, [x]: { icon: null, prompt: "" } },
          madohomuThreadOrder: [b, x, a, c],
        },
        now: NOW,
        threadId: a,
        direction: "up",
      }),
    ).toEqual([a, b, x, c]);
  });

  it("does not move past a section's ends or move Scratch threads", () => {
    expect(
      moveMadoHomuThread({ threads, settings, now: NOW, threadId: a, direction: "down" }),
    ).toBeNull();
    expect(
      moveMadoHomuThread({ threads, settings, now: NOW, threadId: c, direction: "up" }),
    ).toBeNull();
    expect(
      moveMadoHomuThread({ threads, settings, now: NOW, threadId: s, direction: "up" }),
    ).toBeNull();
  });
});

describe("dropMadoHomuThread", () => {
  const drop = (threadId: ThreadId, sectionId: string, index: number, base = settings) =>
    dropMadoHomuThread({ threads, settings: base, now: NOW, threadId, sectionId, index });

  it("reorders within a section and moves between Pinned and custom sections", () => {
    expect(drop(a, "pinned", 0)).toEqual({ order: [a, b, c], section: null });
    expect(drop(b, "pinned", 1)).toEqual({ order: [a, b, c], section: null });
    expect(drop(b, "work", 0)).toEqual({ order: [a, b, c], section: "work" });
    expect(drop(a, "work", 1)).toEqual({ order: [b, c, a], section: "work" });
    expect(drop(c, "pinned", 1)).toEqual({ order: [b, c, a], section: null });
    expect(drop(c, "pinned", 0)).toEqual({ order: [c, b, a], section: null });
    expect(drop(a, "empty", 0)).toEqual({ order: [b, a, c], section: "empty" });
  });

  it("keeps the saved position of a pinned thread that is snoozed", () => {
    const x = ThreadId.make("x");
    const snoozed = makeThreadShellFixture({
      id: x,
      title: "X",
      snoozedUntil: "2026-06-03T00:00:00.000Z",
    });
    expect(
      dropMadoHomuThread({
        threads: [...threads, snoozed],
        settings: {
          ...settings,
          madohomuThreads: { ...settings.madohomuThreads, [x]: { icon: null, prompt: "" } },
          madohomuThreadOrder: [b, x, a, c],
        },
        now: NOW,
        threadId: b,
        sectionId: "pinned",
        index: 1,
      }),
    ).toEqual({ order: [x, a, b, c], section: null });
  });

  it("ignores a drop in place, Scratch threads and sections that are not manual", () => {
    expect(drop(b, "pinned", 0)).toBeNull();
    expect(drop(c, "work", 0)).toBeNull();
    expect(drop(s, "pinned", 0)).toBeNull();
    expect(drop(a, "scratch", 0)).toBeNull();
    expect(drop(a, "missing", 0)).toBeNull();
  });
});
