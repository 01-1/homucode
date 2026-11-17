import { describe, expect, it } from "vite-plus/test";

import { reconcileSearchFieldText } from "./searchFieldText";

describe("reconcileSearchFieldText", () => {
  it("keeps newer typed text when an older reported value arrives", () => {
    expect(
      reconcileSearchFieldText({ text: "sett", pending: ["s", "se", "set", "sett"] }, "se"),
    ).toEqual({ text: "sett", pending: ["set", "sett"] });
  });

  it("settles once the latest reported value arrives", () => {
    expect(reconcileSearchFieldText({ text: "sett", pending: ["set", "sett"] }, "sett")).toEqual({
      text: "sett",
      pending: [],
    });
  });

  it("takes a value set from outside the field", () => {
    expect(reconcileSearchFieldText({ text: "sett", pending: ["sett"] }, "")).toEqual({
      text: "",
      pending: [],
    });
  });
});
