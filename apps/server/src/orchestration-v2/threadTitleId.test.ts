import { describe, expect, it } from "vite-plus/test";

import {
  assignThreadTitleId,
  syncThreadTitleId,
  threadTitleIdMatchesInitial,
  threadTitleInitial,
} from "./threadTitleId.ts";

const taken = (...ids: string[]) => new Set(ids);

describe("thread title IDs", () => {
  it("uses the title's first letter or digit", () => {
    expect(threadTitleInitial("fix login bug")).toBe("F");
    expect(threadTitleInitial("(beta) rollout")).toBe("B");
    expect(threadTitleInitial("修复 登录")).toBe("修");
    expect(threadTitleInitial("—")).toBeUndefined();
  });

  it("numbers active IDs in base 10 only on a collision", () => {
    expect(assignThreadTitleId({ initial: "F", settled: false, taken: taken() })).toBe("F");
    expect(assignThreadTitleId({ initial: "F", settled: false, taken: taken("F") })).toBe("F1");
    expect(
      assignThreadTitleId({ initial: "F", settled: false, taken: taken("F", "F1", "F2") }),
    ).toBe("F3");
    // Settled IDs carry letters, so they never block an active one.
    expect(assignThreadTitleId({ initial: "F", settled: false, taken: taken("Fa", "F1a") })).toBe(
      "F",
    );
  });

  it("adds letters when a thread settles and drops them when it unsettles", () => {
    expect(syncThreadTitleId({ id: "F1", settled: true, taken: taken() })).toBe("F1a");
    expect(syncThreadTitleId({ id: "F1", settled: true, taken: taken("F1a") })).toBe("F1b");
    expect(syncThreadTitleId({ id: "F1a", settled: true, taken: taken() })).toBe("F1a");
    expect(syncThreadTitleId({ id: "F1a", settled: false, taken: taken() })).toBe("F1");
    // An active thread took F1 while this one was settled: take the next free number.
    expect(syncThreadTitleId({ id: "F1a", settled: false, taken: taken("F", "F1") })).toBe("F2");
    expect(syncThreadTitleId({ id: "F", settled: false, taken: taken() })).toBe("F");
    // A restored duplicate gets a fresh number.
    expect(syncThreadTitleId({ id: "F", settled: false, taken: taken("F") })).toBe("F1");
    const many = taken(...Array.from({ length: 26 }, (_, n) => `F${String.fromCharCode(97 + n)}`));
    expect(syncThreadTitleId({ id: "F", settled: true, taken: many })).toBe("Faa");
  });

  it("keeps an ID while the title keeps its first letter", () => {
    expect(threadTitleIdMatchesInitial("F12b", "F")).toBe(true);
    expect(threadTitleIdMatchesInitial("F12", "G")).toBe(false);
    expect(threadTitleIdMatchesInitial("修1", "修")).toBe(true);
  });
});
