import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import {
  duetMorningBriefInput,
  duetTaskLabel,
  findDuetMorningBriefThread,
  MORNING_BRIEF_PROMPT,
  orderDuetTasks,
  selectDuetEnvironment,
} from "./duet.ts";

it("reuses a renamed bound brief thread within the Duet project, excluding other environments and closed threads", () => {
  const environmentId = EnvironmentId.make("duet-environment");
  const projectId = ProjectId.make("duet-project");
  const row = {
    environmentId,
    projectId,
    id: ThreadId.make("fallback"),
    title: "Morning brief",
    archivedAt: null,
    deletedAt: null,
  };
  const bound = { ...row, id: ThreadId.make("bound"), title: "Daily update" };
  const unavailable = [
    { ...row, environmentId: EnvironmentId.make("other-environment") },
    { ...row, projectId: ProjectId.make("other-project") },
    { ...row, archivedAt: "2026-11-16" },
    { ...row, deletedAt: "2026-11-16" },
  ];
  const threads = [...unavailable, row, bound];
  expect(findDuetMorningBriefThread(threads, environmentId, projectId, bound.id)).toBe(bound);
  expect(findDuetMorningBriefThread(threads, environmentId, projectId, null)).toBe(row);
  expect(findDuetMorningBriefThread(unavailable, environmentId, projectId, row.id)).toBeUndefined();
});

it.each(["web", "mobile"] as const)(
  "creates an approval-required daily brief for %s that continues its pinned thread",
  (creationSource) => {
    const input = {
      id: ScheduledTaskId.make("morning-brief"),
      projectId: ProjectId.make("duet-project"),
      threadId: ThreadId.make("brief-thread"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
      timeOfDay: "08:30",
      creationSource,
    };
    expect(duetMorningBriefInput(input)).toEqual({
      id: input.id,
      title: "Morning brief",
      prompt: MORNING_BRIEF_PROMPT,
      enabled: true,
      schedule: { type: "fixed_time", timeOfDay: "08:30" },
      projectId: input.projectId,
      threadId: input.threadId,
      threadMode: "continue",
      workspaceStrategy: { type: "root" },
      modelSelection: input.modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      creationSource,
    });
  },
);

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
