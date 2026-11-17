import { describe, expect, it } from "vite-plus/test";

import { madohomuLauncherEnvironmentId, madohomuLauncherWanted } from "./madohomuLauncherState";

const on = (environmentId: string) => ({ environmentId, madohomuEnabled: true });
const off = (environmentId: string) => ({ environmentId, madohomuEnabled: false });
const loading = (environmentId: string) => ({ environmentId, madohomuEnabled: undefined });

describe("madohomuLauncherWanted", () => {
  it("shows the icon as soon as any environment has MadoHomu on", () => {
    expect(madohomuLauncherWanted([loading("a"), on("b")])).toBe(true);
  });

  it("hides it only once every environment's settings say off", () => {
    expect(madohomuLauncherWanted([off("a"), off("b")])).toBe(false);
    expect(madohomuLauncherWanted([off("a"), loading("b")])).toBeUndefined();
    expect(madohomuLauncherWanted([])).toBeUndefined();
  });
});

describe("madohomuLauncherEnvironmentId", () => {
  it("opens the first environment with MadoHomu on", () => {
    expect(madohomuLauncherEnvironmentId([off("a"), on("b"), on("c")])).toBe("b");
    expect(madohomuLauncherEnvironmentId([off("a"), loading("b")])).toBeUndefined();
  });
});
