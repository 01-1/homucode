import { describe, expect, it } from "vite-plus/test";

import { reconcileThreadTitleId, threadTitleInitial } from "./threadTitleId.ts";

const id = (
  current: string | null,
  settled: boolean,
  taken: ReadonlyArray<string> = [],
  title = "Fix login bug",
) => reconcileThreadTitleId({ current, title, settled, taken: new Set(taken) });

describe("thread title IDs", () => {
  it("uses the title's first letter or digit", () => {
    expect(threadTitleInitial("fix login bug")).toBe("F");
    expect(threadTitleInitial("(beta) rollout")).toBe("B");
    expect(threadTitleInitial("修复 登录")).toBe("修");
    expect(threadTitleInitial("—")).toBeUndefined();
    expect(id(null, false, [], "New thread")).toBeNull();
  });

  it("numbers active IDs in base 10 only on a collision", () => {
    expect(id(null, false)).toBe("F");
    expect(id(null, false, ["F"])).toBe("F1");
    expect(id(null, false, ["F", "F1", "F2"])).toBe("F3");
    // Settled IDs carry letters, so they never block an active one.
    expect(id(null, false, ["Fa", "F1a"])).toBe("F");
  });

  it("adds letters when a thread settles", () => {
    expect(id("F1", true)).toBe("F1a");
    expect(id("F1", true, ["F1a"])).toBe("F1b");
    expect(id("F1a", true)).toBe("F1a");
    const many = Array.from({ length: 26 }, (_, n) => `F${String.fromCharCode(97 + n)}`);
    expect(id("F", true, many)).toBe("Faa");
  });

  it("unsettles to its own number when free, otherwise to the lowest free ID", () => {
    expect(id("F1a", false)).toBe("F1");
    expect(id("F20a", false, ["F", "F2"])).toBe("F20");
    expect(id("F20a", false, ["F", "F20"])).toBe("F1");
    expect(id("F20a", false, ["F1", "F20"])).toBe("F");
    // A digit initial is read from the title, not the ID.
    expect(id("71a", false, ["7", "71"], "7 day retention")).toBe("72");
    expect(id("71", false, [], "7 day retention")).toBe("71");
  });

  it("renumbers duplicates and titles that changed letter", () => {
    expect(id("F", false, ["F"])).toBe("F1");
    expect(id("F12", false, [], "Cache tuning")).toBe("C");
    expect(id("F12b", true, [], "Fix again")).toBe("F12b");
  });
});
