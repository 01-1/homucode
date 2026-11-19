import { describe, expect, it } from "vite-plus/test";

import { madohomuLauncherWanted } from "./madohomuLauncherState";

const on = (environmentId: string) => ({ environmentId, madohomuEnabled: true });
const off = (environmentId: string) => ({ environmentId, madohomuEnabled: false });
const loading = (environmentId: string) => ({ environmentId, madohomuEnabled: undefined });

describe("madohomuLauncherWanted", () => {
  it("shows the icon as soon as any environment has MadoHomu on", () => {
    expect(madohomuLauncherWanted([loading("a"), on("b")], false)).toBe(true);
  });

  it("hides it only once every environment's settings say off", () => {
    expect(madohomuLauncherWanted([off("a"), off("b")], true)).toBe(false);
    expect(madohomuLauncherWanted([off("a"), loading("b")], true)).toBeUndefined();
    expect(madohomuLauncherWanted([], false)).toBeUndefined();
    expect(madohomuLauncherWanted([], true)).toBe(false);
  });
});
