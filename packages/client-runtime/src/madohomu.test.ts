import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  DEFAULT_SERVER_SETTINGS,
  MadoHomuThreadSettings,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ServerSettingsPatch,
  ThreadId,
} from "@t3tools/contracts";
import {
  madohomuMorningBriefInput,
  madohomuRuntimeMode,
  groupMadoHomuThreads,
  isMadoHomuThreadShownInCode,
  filterMadoHomuCodeThreads,
  reorderMadoHomuThreads,
  moveMadoHomuThreadsLast,
  findMadoHomuMorningBriefThread,
  findUntouchedMadoHomuThread,
  madohomuListedThreads,
  pageMadoHomuRows,
  resolveMadoHomuSelection,
  isMadoHomuThreadPinned,
  MORNING_BRIEF_PROMPT,
  madoHomuProjectSelectionIssue,
  resolveMadoHomuDestination,
  writeMadoHomuProject,
} from "./madohomu.ts";

it("keeps MadoHomu entries pinned by default and treats other project threads as unpinned", () => {
  const decode = Schema.decodeUnknownSync(MadoHomuThreadSettings);
  expect(isMadoHomuThreadPinned(undefined)).toBe(false);
  expect(isMadoHomuThreadPinned(decode({ icon: null, prompt: "" }))).toBe(true);
  expect(isMadoHomuThreadPinned(decode({ icon: "☀️", prompt: "", pinned: true }))).toBe(true);
  expect(isMadoHomuThreadPinned(decode({ icon: null, prompt: "", pinned: false }))).toBe(false);
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

describe("MadoHomu destination", () => {
  const a = EnvironmentId.make("a-machine");
  const b = EnvironmentId.make("b-machine");
  const c = EnvironmentId.make("c-machine");
  const projectId = ProjectId.make("same-project-id");
  const project = (environmentId: EnvironmentId) => ({ environmentId, projectId });
  const host = (id: EnvironmentId) => ({
    label: id,
    connected: true,
    settingsLoaded: true,
    canWrite: true,
  });

  it("falls back to an enabled legacy host and keeps an explicit destination when its host is offline", () => {
    const legacy = { ...DEFAULT_SERVER_SETTINGS, madohomuEnabled: true };
    const environments = [
      { environmentId: c, settings: legacy },
      { environmentId: b, settings: legacy },
      { environmentId: a, settings: null },
    ];
    expect(resolveMadoHomuDestination(environments)).toEqual({
      anchorEnvironmentId: a,
      savedEnvironmentId: null,
      environmentId: b,
    });
    expect(resolveMadoHomuDestination([...environments].reverse()).environmentId).toBe(b);
    expect(
      resolveMadoHomuDestination([{ environmentId: a, settings: null }]).environmentId,
    ).toBeNull();

    expect(
      resolveMadoHomuDestination([
        ...environments.slice(0, 2),
        { environmentId: a, settings: { ...legacy, madohomuDestinationEnvironmentId: a } },
      ]).savedEnvironmentId,
    ).toBe(a);
    expect(
      resolveMadoHomuDestination([
        { environmentId: c, settings: legacy },
        { environmentId: b, settings: null },
        { environmentId: a, settings: { ...legacy, madohomuDestinationEnvironmentId: b } },
      ]).environmentId,
    ).toBe(b);
  });

  it("keeps the settings host and filters Code threads only on the selected machine", async () => {
    const settings = new Map([
      [a, { ...DEFAULT_SERVER_SETTINGS, madohomuEnabled: true, madohomuProjectId: projectId }],
      [b, { ...DEFAULT_SERVER_SETTINGS }],
      [c, { ...DEFAULT_SERVER_SETTINGS }],
    ]);
    const destination = () =>
      resolveMadoHomuDestination(
        [c, b, a].map((environmentId) => ({
          environmentId,
          settings: settings.get(environmentId)!,
        })),
      );
    const threads = [a, b, c].map((environmentId) => ({
      environmentId,
      projectId,
      id: ThreadId.make("same-thread-id"),
    }));
    const visibleMachines = () =>
      filterMadoHomuCodeThreads(threads, settings).map((thread) => thread.environmentId);
    const writes: Array<{ environmentId: EnvironmentId; patch: ServerSettingsPatch }> = [];
    const save = async (environmentId: EnvironmentId, patch: ServerSettingsPatch) => {
      writes.push({ environmentId, patch });
      const previous = settings.get(environmentId)!;
      const saved = {
        ...previous,
        madohomuEnabled: patch.madohomuEnabled ?? previous.madohomuEnabled,
        madohomuProjectId: patch.madohomuProjectId ?? previous.madohomuProjectId,
        madohomuDestinationEnvironmentId:
          patch.madohomuDestinationEnvironmentId ?? previous.madohomuDestinationEnvironmentId,
      };
      settings.set(environmentId, saved);
      return saved;
    };

    expect(destination().environmentId).toBe(a);
    expect(visibleMachines()).toEqual([b, c]);
    await writeMadoHomuProject(destination(), project(b), host, save);
    expect(destination().environmentId).toBe(b);
    expect(visibleMachines()).toEqual([a, c]);
    await writeMadoHomuProject(destination(), project(c), host, save);
    expect(destination().environmentId).toBe(c);
    expect(visibleMachines()).toEqual([a, b]);
    await writeMadoHomuProject(destination(), project(c), host, save);
    expect(writes).toEqual([
      { environmentId: b, patch: { madohomuEnabled: true, madohomuProjectId: projectId } },
      { environmentId: a, patch: { madohomuDestinationEnvironmentId: b } },
      { environmentId: c, patch: { madohomuEnabled: true, madohomuProjectId: projectId } },
      { environmentId: a, patch: { madohomuDestinationEnvironmentId: c } },
      { environmentId: c, patch: { madohomuEnabled: true, madohomuProjectId: projectId } },
    ]);
  });

  it("names the machine that needs a connection or settings write access", () => {
    const destination = { anchorEnvironmentId: a, savedEnvironmentId: b, environmentId: b };
    const readHost = (id: EnvironmentId) => ({
      ...host(id),
      connected: id !== c,
      canWrite: id !== a,
    });

    expect(madoHomuProjectSelectionIssue(destination, c, readHost)).toBe(
      "Connect to c-machine to change the project.",
    );
    expect(
      madoHomuProjectSelectionIssue(destination, c, (id) => ({
        ...readHost(id),
        connected: true,
      })),
    ).toBe("Settings write access on a-machine is required to save the launch destination.");
    expect(
      madoHomuProjectSelectionIssue(destination, c, (id) => ({
        ...host(id),
        connected: id !== a,
      })),
    ).toBe("Connect to a-machine to save the launch destination.");
    expect(madoHomuProjectSelectionIssue(destination, b, readHost)).toBeNull();
  });

  it("reports a destination failure after saving the project and stops when the project write fails", async () => {
    const oldSettings = { ...DEFAULT_SERVER_SETTINGS, madohomuDestinationEnvironmentId: b };
    const destination = resolveMadoHomuDestination([{ environmentId: a, settings: oldSettings }]);
    const writes: EnvironmentId[] = [];
    await expect(
      writeMadoHomuProject(destination, project(c), host, async (id) => {
        writes.push(id);
        if (id === a) throw new Error("Connection closed");
        return { ...DEFAULT_SERVER_SETTINGS, madohomuEnabled: true, madohomuProjectId: projectId };
      }),
    ).rejects.toThrow(
      "The project was saved on its machine. The launch destination could not be saved on a-machine. Connection closed",
    );
    expect(writes).toEqual([c, a]);

    writes.length = 0;
    await expect(
      writeMadoHomuProject(destination, project(c), host, async (id) => {
        writes.push(id);
        return DEFAULT_SERVER_SETTINGS;
      }),
    ).rejects.toThrow("c-machine did not save the project selection.");
    expect(writes).toEqual([c]);

    await expect(
      writeMadoHomuProject(destination, project(a), host, async () => ({
        ...oldSettings,
        madohomuProjectId: projectId,
        madohomuEnabled: true,
      })),
    ).rejects.toThrow(
      "The project was saved on its machine. The launch destination could not be saved on a-machine.",
    );
  });
});

describe("MadoHomu sections", () => {
  const shell = (id: string, updatedAt: string, extra: object = {}) => ({
    id: ThreadId.make(id),
    projectId: ProjectId.make("p"),
    createdAt: updatedAt,
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
        shell("new", "2026-11-12", { updatedAt: "2026-11-01" }),
        shell("gone", "2026-11-11", { updatedAt: "2026-11-16" }),
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
      groups.map((group) => [
        group.title,
        group.threads.map((thread: { id: string }) => thread.id),
      ]),
    ).toEqual([
      ["Pinned", ["new", "gone", "b", "a"]],
      ["Work", ["filed"]],
      ["Working", []],
      ["Scratch", ["outside", "unpinned"]],
      ["Snoozed", ["later"]],
      ["Settled", ["done"]],
    ]);
  });

  it("orders Scratch by what the user last wrote, so agent activity never moves a row", () => {
    const groups = groupMadoHomuThreads(
      [
        shell("busy", "2026-11-01", {
          updatedAt: "2026-11-16",
          latestUserAuthoredMessageAt: "2026-11-02",
        }),
        shell("recent", "2026-11-01", {
          updatedAt: "2026-11-05",
          latestUserAuthoredMessageAt: "2026-11-04",
        }),
        shell("agent-made", "2026-11-03", {
          updatedAt: "2026-11-16",
          latestUserAuthoredMessageAt: null,
        }),
      ] as never,
      { ...settings, madohomuWorkingPlacement: "none" },
      { now: "2026-11-17T00:00:00.000Z", isWorking: () => true },
    );
    expect(
      groups
        .find((group) => group.kind === "scratch")
        ?.threads.map((thread: { id: string }) => thread.id),
    ).toEqual(["recent", "agent-made", "busy"]);
  });

  it("shows a working Scratch thread where the setting says, and never moves a pinned one", () => {
    const threads = [
      shell("a", "2026-11-10"),
      shell("outside", "2026-11-14"),
      shell("busy", "2026-11-01"),
    ] as never;
    const placed = (madohomuWorkingPlacement: "section" | "top" | "none") =>
      groupMadoHomuThreads(
        threads,
        { ...settings, madohomuWorkingPlacement },
        {
          now: "2026-11-17T00:00:00.000Z",
          isWorking: (thread: { id: string }) => thread.id === "busy" || thread.id === "a",
        },
      )
        .filter((group) => group.threads.length > 0)
        .map((group) => [group.title, group.threads.map((thread: { id: string }) => thread.id)]);
    expect(placed("section")).toEqual([
      ["Pinned", ["a"]],
      ["Working", ["busy"]],
      ["Scratch", ["outside"]],
    ]);
    expect(placed("top")).toEqual([
      ["Pinned", ["a"]],
      ["Scratch", ["busy", "outside"]],
    ]);
    expect(placed("none")).toEqual([
      ["Pinned", ["a"]],
      ["Scratch", ["outside", "busy"]],
    ]);
  });

  it("lists filed subagents and the open one", () => {
    const sub = (id: string) => ({
      id: ThreadId.make(id),
      lineage: { relationshipToParent: "subagent" as const },
    });
    const top = { id: ThreadId.make("top"), lineage: { relationshipToParent: null } };
    const listed = madohomuListedThreads(
      [top, sub("a"), sub("loose"), sub("open")] as never,
      settings,
      ThreadId.make("open"),
    );
    expect(listed.map((t: { id: string }) => t.id)).toEqual(["top", "a", "open"]);
  });

  it("keeps the named thread open and falls back only once it is gone", () => {
    const project = ProjectId.make("p");
    const live = { projectId: project, deletedAt: null, archivedAt: null };
    const base = {
      namedId: ThreadId.make("named"),
      projectId: project,
      listLoaded: true,
      firstId: ThreadId.make("first"),
    };
    const fallback = { threadId: "first", loading: false, replace: true };
    // Hidden by the list's filtering, but still in the project: it stays.
    expect(resolveMadoHomuSelection({ ...base, named: live })).toEqual({
      threadId: "named",
      loading: false,
      replace: false,
    });
    // Not loaded yet: loading, never another thread.
    expect(resolveMadoHomuSelection({ ...base, named: null, listLoaded: false })).toEqual({
      threadId: null,
      loading: true,
      replace: false,
    });
    // Absent once the list has loaded, deleted, archived or moved: the first row replaces it.
    expect(resolveMadoHomuSelection({ ...base, named: null })).toEqual(fallback);
    expect(resolveMadoHomuSelection({ ...base, named: { ...live, deletedAt: "x" } })).toEqual(
      fallback,
    );
    expect(resolveMadoHomuSelection({ ...base, named: { ...live, archivedAt: "x" } })).toEqual(
      fallback,
    );
    expect(
      resolveMadoHomuSelection({ ...base, named: { ...live, projectId: ProjectId.make("q") } }),
    ).toEqual(fallback);
    // No thread named: the first row goes into the URL.
    expect(resolveMadoHomuSelection({ ...base, namedId: undefined, named: null })).toEqual(
      fallback,
    );
  });

  it("reopens an untouched New thread instead of making another", () => {
    const fresh = {
      id: ThreadId.make("a"),
      title: "New thread",
      latestUserMessageAt: null,
      latestRun: null,
    };
    const touched = [
      { ...fresh, id: ThreadId.make("b"), latestUserMessageAt: "2026-11-17" },
      { ...fresh, id: ThreadId.make("new"), title: "Renamed" },
      { ...fresh, id: ThreadId.make("later") },
      { ...fresh, id: ThreadId.make("unpinned") },
      { ...fresh, id: ThreadId.make("outside") },
      { ...fresh, id: ThreadId.make("filed") },
    ];
    const withIcon = {
      ...settings,
      madohomuThreads: {
        ...settings.madohomuThreads,
        [ThreadId.make("later")]: entry({ icon: "☀️" }),
      },
    };
    expect(findUntouchedMadoHomuThread(touched, withIcon)).toBeUndefined();
    expect(findUntouchedMadoHomuThread([...touched, fresh], withIcon)).toBe(fresh);
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

  it("moves a selection last in the order its rows are shown", () => {
    const [a, b, c, d, e] = [
      ThreadId.make("a"),
      ThreadId.make("b"),
      ThreadId.make("c"),
      ThreadId.make("d"),
      ThreadId.make("e"),
    ];
    // Shown d, b (d's row is first on screen), selected as [b, d] from the thread list; e has
    // no row yet and stays after them.
    expect(moveMadoHomuThreadsLast([a, b, c], [d, a, b, c], [b, e, d])).toEqual([a, c, d, b, e]);
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

describe("filterMadoHomuCodeThreads", () => {
  const env = EnvironmentId.make("env-a");
  const other = EnvironmentId.make("env-b");
  const mado = ProjectId.make("mado");
  const thread = (id: string, environmentId = env, projectId = mado) => ({
    environmentId,
    id: ThreadId.make(id),
    projectId,
  });
  const settings = { ...DEFAULT_SERVER_SETTINGS, madohomuEnabled: true, madohomuProjectId: mado };
  const threads = [
    thread("hidden"),
    thread("open"),
    thread("elsewhere", env, ProjectId.make("other")),
    thread("same-project-other-env", other),
  ];

  it("hides the project's threads per environment but keeps the open thread", () => {
    const shown = filterMadoHomuCodeThreads(
      threads,
      new Map([[env, settings]]),
      (candidate) => candidate.id === "open",
    );
    expect(shown.map((candidate) => candidate.id)).toEqual([
      "open",
      "elsewhere",
      "same-project-other-env",
    ]);
  });

  it("returns the list untouched when no environment hides threads", () => {
    const all = { ...settings, madohomuCodeVisibility: "all" as const };
    expect(filterMadoHomuCodeThreads(threads, new Map([[env, all]]))).toBe(threads);
  });
});

it("keeps rows that need the user visible past the page", () => {
  const rows = ["a", "b", "c", "needs-me", "d"];
  expect(pageMadoHomuRows(rows, 2, (row) => row === "needs-me")).toEqual({
    shown: ["a", "b", "needs-me"],
    more: 2,
  });
  expect(pageMadoHomuRows(rows, 10, () => false)).toEqual({ shown: rows, more: 0 });
});
