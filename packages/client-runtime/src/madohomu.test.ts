import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  DEFAULT_SERVER_SETTINGS,
  MadoHomuThreadSettings,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import {
  madohomuMorningBriefInput,
  madohomuRuntimeMode,
  madohomuTaskLabel,
  groupMadoHomuThreads,
  isMadoHomuThreadShownInCode,
  reorderMadoHomuThreads,
  findMadoHomuMorningBriefThread,
  isMadoHomuThreadPinned,
  MORNING_BRIEF_PROMPT,
  orderMadoHomuThreads,
  orderMadoHomuTasks,
  selectMadoHomuEnvironment,
} from "./madohomu.ts";

it("keeps MadoHomu entries pinned by default and treats other project threads as temporary", () => {
  const decode = Schema.decodeUnknownSync(MadoHomuThreadSettings);
  expect(isMadoHomuThreadPinned(undefined)).toBe(false);
  expect(isMadoHomuThreadPinned(decode({ icon: null, prompt: "" }))).toBe(true);
  expect(isMadoHomuThreadPinned(decode({ icon: "☀️", prompt: "", pinned: true }))).toBe(true);
  expect(isMadoHomuThreadPinned(decode({ icon: null, prompt: "", pinned: false }))).toBe(false);
});

it("orders kept threads before temporary threads independently of device pins", () => {
  const kept = { id: ThreadId.make("kept"), updatedAt: "2026-11-14", pinnedAt: null };
  const legacy = { id: ThreadId.make("legacy"), updatedAt: "2026-11-15", pinnedAt: null };
  const temporary = {
    id: ThreadId.make("temporary"),
    updatedAt: "2026-11-16",
    pinnedAt: "2026-11-16",
  };
  const other = { id: ThreadId.make("other"), updatedAt: "2026-11-13", pinnedAt: "2026-11-16" };
  const rows = [temporary, kept, other, legacy];
  const entries = {
    [kept.id]: { icon: null, prompt: "", pinned: true },
    [legacy.id]: { icon: null, prompt: "" },
    [temporary.id]: { icon: null, prompt: "", pinned: false },
  };
  expect(orderMadoHomuThreads(rows, entries)).toEqual([legacy, kept, temporary, other]);
  expect(rows[0]).toBe(temporary);
});

it("reuses a renamed bound brief thread within the MadoHomu project, excluding other environments and closed threads", () => {
  const environmentId = EnvironmentId.make("madohomu-environment");
  const projectId = ProjectId.make("madohomu-project");
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
  expect(findMadoHomuMorningBriefThread(threads, environmentId, projectId, bound.id)).toBe(bound);
  expect(findMadoHomuMorningBriefThread(threads, environmentId, projectId, null)).toBe(row);
  expect(
    findMadoHomuMorningBriefThread(unavailable, environmentId, projectId, row.id),
  ).toBeUndefined();
});

it.each(["web", "mobile"] as const)(
  "creates a daily brief for %s that continues its pinned thread",
  (creationSource) => {
    const input = {
      id: ScheduledTaskId.make("morning-brief"),
      projectId: ProjectId.make("madohomu-project"),
      threadId: ThreadId.make("brief-thread"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
      runtimeMode: "auto-accept-edits" as const,
      timeOfDay: "08:30",
      creationSource,
    };
    expect(madohomuMorningBriefInput(input)).toEqual({
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
      runtimeMode: "auto-accept-edits",
      interactionMode: "plan",
      creationSource,
    });
  },
);

it("starts MadoHomu threads in the project's default permission mode, like new threads", () => {
  const project = { id: ProjectId.make("madohomu-project") };
  const settings = { ...DEFAULT_SERVER_SETTINGS, defaultRuntimeMode: "auto-accept-edits" as const };
  expect(madohomuRuntimeMode(settings, project)).toBe("auto-accept-edits");
  expect(
    madohomuRuntimeMode(
      {
        ...settings,
        projectSettingsOverrides: { [project.id]: { defaultRuntimeMode: "approval-required" } },
      },
      project,
    ),
  ).toBe("approval-required");
});

describe("MadoHomu tasks", () => {
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
    expect(orderMadoHomuTasks(rows).map((row) => row.id)).toEqual([
      "input",
      "approval",
      "running",
      "recent",
    ]);
    expect(rows.map(madohomuTaskLabel)).toEqual([
      "Recent",
      "Needs approval",
      "Needs input",
      "Running",
    ]);
    expect(rows[0]?.id).toBe("recent");
  });
});

it("chooses an enabled remote MadoHomu destination with a disabled primary or no primary, and removes it when disabled", () => {
  const local = {
    environmentId: EnvironmentId.make("local"),
    madohomuEnabled: false,
    madohomuDesktopAppEnabled: false,
  };
  const remote = {
    environmentId: EnvironmentId.make("remote"),
    madohomuEnabled: true,
    madohomuDesktopAppEnabled: true,
  };
  expect(selectMadoHomuEnvironment(local.environmentId, [local, remote])).toBe(
    remote.environmentId,
  );
  expect(selectMadoHomuEnvironment(null, [local, remote])).toBe(remote.environmentId);
  expect(
    selectMadoHomuEnvironment(local.environmentId, [local, { ...remote, madohomuEnabled: false }]),
  ).toBeNull();
  expect(
    selectMadoHomuEnvironment(local.environmentId, [{ ...local, madohomuEnabled: true }, remote]),
  ).toBe(remote.environmentId);
});

describe("MadoHomu sections", () => {
  const shell = (id: string, updatedAt: string, extra: object = {}) => ({
    id: ThreadId.make(id),
    projectId: ProjectId.make("p"),
    updatedAt,
    settledOverride: null,
    runtime: null,
    snoozedUntil: null,
    snoozedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...extra,
  });
  const entry = (extra: object = {}) => ({ icon: null, prompt: "", ...extra });
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    madohomuEnabled: true,
    madohomuProjectId: ProjectId.make("p"),
    madohomuSections: [{ id: "work", name: "Work" }],
    madohomuThreadOrder: [ThreadId.make("b"), ThreadId.make("a")],
    madohomuThreads: {
      [ThreadId.make("a")]: entry(),
      [ThreadId.make("b")]: entry(),
      [ThreadId.make("new")]: entry(),
      [ThreadId.make("filed")]: entry({ section: "work" }),
      [ThreadId.make("gone")]: entry({ section: "deleted-section" }),
      [ThreadId.make("unpinned")]: entry({ pinned: false }),
      [ThreadId.make("done")]: entry(),
      [ThreadId.make("later")]: entry(),
    },
  };

  it("groups threads into Pinned, custom sections, Scratch, Snoozed and Settled", () => {
    const groups = groupMadoHomuThreads(
      [
        shell("a", "2026-11-10"),
        shell("b", "2026-11-11"),
        shell("new", "2026-11-12"),
        shell("gone", "2026-11-13"),
        shell("filed", "2026-11-12"),
        shell("unpinned", "2026-11-12"),
        shell("outside", "2026-11-14"),
        shell("done", "2026-11-12", { settledOverride: "settled" }),
        shell("later", "2026-11-12", { snoozedUntil: "2026-12-01T00:00:00.000Z" }),
      ] as never,
      settings,
      { now: "2026-11-17T00:00:00.000Z" },
    );
    expect(
      groups.map((group) => [group.title, group.threads.map((thread: { id: string }) => thread.id)]),
    ).toEqual([
      ["Pinned", ["gone", "new", "b", "a"]],
      ["Work", ["filed"]],
      ["Scratch", ["outside", "unpinned"]],
      ["Snoozed", ["later"]],
      ["Settled", ["done"]],
    ]);
  });

  it("moves a thread before another, or to the end", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => ThreadId.make(id)) as [
      ThreadId,
      ThreadId,
      ThreadId,
    ];
    expect(reorderMadoHomuThreads([a, b, c], c, a)).toEqual([c, a, b]);
    expect(reorderMadoHomuThreads([a, b, c], a, null)).toEqual([b, c, a]);
  });

  it("hides the MadoHomu project from T3 Code unless the setting shows it", () => {
    const shown = (visibility: "hidden" | "scratch" | "all", id: string, projectId = "p") =>
      isMadoHomuThreadShownInCode(
        { ...settings, madohomuCodeVisibility: visibility },
        { id: ThreadId.make(id), projectId: ProjectId.make(projectId) },
      );
    expect([shown("hidden", "a"), shown("hidden", "outside")]).toEqual([false, false]);
    expect([shown("scratch", "a"), shown("scratch", "outside")]).toEqual([false, true]);
    expect(shown("all", "a")).toBe(true);
    expect(shown("hidden", "a", "other-project")).toBe(true);
    expect(
      isMadoHomuThreadShownInCode(
        { ...settings, madohomuEnabled: false },
        { id: ThreadId.make("a"), projectId: ProjectId.make("p") },
      ),
    ).toBe(true);
  });
});
