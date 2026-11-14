import { describe, expect, it } from "vite-plus/test";

import { assignThreadTitleId, splitThreadTitleId, threadTitleInitials } from "./threadTitleId.ts";

describe("thread title IDs", () => {
  it("takes the first letter of the first three words", () => {
    expect(threadTitleInitials("Fix login bug on mobile")).toBe("FLB");
    expect(threadTitleInitials("titler: (project) name")).toBe("TPN");
    expect(threadTitleInitials("Backup — B2 check")).toBe("BBC");
    expect(threadTitleInitials("Fix")).toBe("F");
  });

  it("adds a base-36 counter from 0 only on a collision", () => {
    expect(assignThreadTitleId("Fix login bug", ["Other thread"])).toBe("FLB");
    expect(assignThreadTitleId("Fix login bug", ["FLB Find lost backups"])).toBe("FLB0");
    const taken = ["FLB a", ...Array.from({ length: 10 }, (_, n) => `FLB${n} b`)];
    expect(assignThreadTitleId("Fix login bug", taken)).toBe("FLBa");
    expect(assignThreadTitleId("Fix login bug", ["FLB0 a"])).toBe("FLB");
    expect(assignThreadTitleId("—", [])).toBeUndefined();
  });

  it("splits an ID word off a title and leaves ordinary first words alone", () => {
    expect(splitThreadTitleId("FLB0 Fix login bug")).toEqual({ id: "FLB0", rest: "Fix login bug" });
    expect(splitThreadTitleId("Fix login bug")).toEqual({ id: undefined, rest: "Fix login bug" });
    expect(splitThreadTitleId("FLB")).toEqual({ id: undefined, rest: "FLB" });
  });
});
