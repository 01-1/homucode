import { ThreadId, type ServerSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { buildMadoHomuListRows, moveMadoHomuThread } from "./madohomuList";

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
  "madohomuThreads" | "madohomuSections" | "madohomuThreadOrder"
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
};

const summary = (rows: ReturnType<typeof buildMadoHomuListRows>) =>
  rows.map((row) =>
    row.type === "thread" ? row.row.item.thread.id : `${row.type}:${row.key.split(":")[1]}`,
  );

describe("buildMadoHomuListRows", () => {
  it("lists every section in order, keeps empty custom sections and hides empty Scratch", () => {
    const rows = buildMadoHomuListRows({ threads, settings, now: NOW, expanded: new Set() });
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
      expanded: new Set(),
    });
    expect(summary(collapsed).slice(-1)).toEqual(["section:settled"]);
    const open = buildMadoHomuListRows({
      threads: settled,
      settings,
      now: NOW,
      expanded: new Set(["settled"]),
    });
    expect(summary(open).slice(-2)).toEqual(["section:settled", "done"]);
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
