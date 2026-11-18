import { ThreadId, type ServerSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { buildMadoHomuListRows, dropMadoHomuThread, moveMadoHomuThread } from "./madohomuList";

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

describe("buildMadoHomuListRows", () => {
  it("lists every section in order, keeps empty custom sections and hides empty Scratch", () => {
    const rows = buildMadoHomuListRows({ threads, settings, now: NOW, toggled: new Set() });
    expect(summary(rows)).toEqual([
      "section:pinned",
      b,
      a,
      "section:work",
      c,
      "section:empty",
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

  it("collapses Settled until it is expanded", () => {
    const settled = [
      ...threads,
      makeThreadShellFixture({
        id: ThreadId.make("done"),
        title: "Done",
        settledOverride: "settled",
      }),
    ];
    const collapsed = buildMadoHomuListRows({
      threads: settled,
      settings,
      now: NOW,
      toggled: new Set(),
    });
    expect(summary(collapsed).slice(-1)).toEqual(["section:settled"]);
    const open = buildMadoHomuListRows({
      threads: settled,
      settings,
      now: NOW,
      toggled: new Set(["settled"]),
    });
    expect(summary(open).slice(-2)).toEqual(["section:settled", "done"]);
  });

  it("collapses any section, counting the rows that need the user, except in Reorder mode", () => {
    const asking = threads.map((thread) =>
      thread.id === b ? { ...thread, hasPendingApprovals: true } : thread,
    );
    const rows = buildMadoHomuListRows({
      threads: asking,
      settings,
      now: NOW,
      toggled: new Set(["pinned"]),
    });
    expect(summary(rows).slice(0, 2)).toEqual(["section:pinned", "section:work"]);
    expect(rows[0]).toMatchObject({ expanded: false, attention: 1 });
    const reorder = buildMadoHomuListRows({
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
    const scratch = Array.from({ length: 5 }, (_, index) =>
      makeThreadShellFixture({
        id: ThreadId.make(`x${index}`),
        title: `X${index}`,
        latestUserMessageAt: `2026-06-01T0${9 - index}:00:00.000Z`,
        latestUserAuthoredMessageAt: `2026-06-01T0${9 - index}:00:00.000Z`,
        hasPendingUserInput: index === 4,
      }),
    );
    const rows = buildMadoHomuListRows({
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
      "x4",
      "more:scratch",
    ]);
    expect(rows.at(-1)).toMatchObject({ type: "more", count: 3 });
  });

  it("says nothing pinned in an empty Pinned section", () => {
    const rows = buildMadoHomuListRows({
      threads: threads.filter((thread) => thread.id === s),
      settings: { ...settings, madohomuThreads: {}, madohomuThreadOrder: [] },
      now: NOW,
      toggled: new Set(),
    });
    expect(summary(rows)).toEqual([
      "section:pinned",
      "empty:pinned",
      "section:work",
      "section:empty",
      "section:scratch",
      s,
    ]);
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
