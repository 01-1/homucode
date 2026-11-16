import { describe, expect, it } from "vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { duetTaskLabel, orderDuetTasks, selectDuetEnvironment } from "./duet.ts";

describe("Duet tasks", () => {
  it("puts decisions before running work and recent threads, newest first within each group", () => {
    const task = (id: string, updatedAt: string, extra = {}) => ({
      id: ThreadId.make(id),
      updatedAt,
      runtime: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      ...extra,
    });
    const recent = task("recent", "2026-11-16");
    const approval = task("approval", "2026-11-14", { hasPendingApprovals: true });
    const input = task("input", "2026-11-15", { hasPendingUserInput: true });
    const running = { ...task("running", "2026-11-16"), runtime: { status: "running" as const } };
    const rows = [recent, approval, input, running];
    expect(orderDuetTasks(rows).map((row) => row.id)).toEqual([
      "input",
      "approval",
      "running",
      "recent",
    ]);
    expect(rows.map(duetTaskLabel)).toEqual(["Recent", "Needs approval", "Needs input", "Running"]);
    expect(rows[0]?.id).toBe("recent");
  });
});

it("chooses an enabled remote Duet destination with a disabled primary or no primary, and removes it when disabled", () => {
  const local = {
    environmentId: EnvironmentId.make("local"),
    duetEnabled: false,
    duetDesktopAppEnabled: false,
  };
  const remote = {
    environmentId: EnvironmentId.make("remote"),
    duetEnabled: true,
    duetDesktopAppEnabled: true,
  };
  expect(selectDuetEnvironment(local.environmentId, [local, remote])).toBe(remote.environmentId);
  expect(selectDuetEnvironment(null, [local, remote])).toBe(remote.environmentId);
  expect(
    selectDuetEnvironment(local.environmentId, [local, { ...remote, duetEnabled: false }]),
  ).toBeNull();
  expect(
    selectDuetEnvironment(local.environmentId, [{ ...local, duetEnabled: true }, remote]),
  ).toBe(remote.environmentId);
});
