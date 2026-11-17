import type {
  MadoHomuThreadSettings,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ScheduledTaskId,
  ScheduledTaskUpsertInput,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";
import type { EnvironmentThreadShell } from "./state/models.ts";
import {
  effectiveSnoozed,
  isShelvedSettled,
  type ThreadSnoozeShell,
} from "./state/threadSettled.ts";

export function isMadoHomuThreadPinned(entry: MadoHomuThreadSettings | undefined): boolean {
  return entry !== undefined && entry.pinned !== false;
}

/** The section for threads that are not pinned: made outside MadoHomu, or unpinned by the user. */
export const MADOHOMU_SCRATCH_LABEL = "Scratch";

export type MadoHomuGroupKind = "pinned" | "custom" | "working" | "scratch" | "snoozed" | "settled";
export interface MadoHomuGroup<T> {
  readonly kind: MadoHomuGroupKind;
  /** The section id for a custom section, otherwise the kind. */
  readonly id: string;
  readonly title: string;
  readonly threads: T[];
}

type MadoHomuGroupSettings = Pick<
  ServerSettings,
  "madohomuThreads" | "madohomuSections" | "madohomuThreadOrder" | "madohomuWorkingPlacement"
>;

/**
 * The one grouping web and mobile both render: Pinned, custom sections, Working, Scratch, Snoozed,
 * Settled. `isWorking` is each client's own test for a thread that is busy and does not need the
 * user; only Scratch threads move for it, so pinned threads never leave their place.
 */
export function groupMadoHomuThreads<
  T extends Pick<
    EnvironmentThreadShell,
    "id" | "createdAt" | "updatedAt" | "settledOverride" | "runtime"
  > &
    ThreadSnoozeShell,
>(
  threads: ReadonlyArray<T>,
  settings: MadoHomuGroupSettings,
  options: { readonly now: string; readonly isWorking?: (thread: T) => boolean },
): MadoHomuGroup<T>[] {
  const working = (thread: T) =>
    settings.madohomuWorkingPlacement !== "none" && options.isWorking?.(thread) === true;
  const groups: MadoHomuGroup<T>[] = [
    { kind: "pinned", id: "pinned", title: "Pinned", threads: [] },
    ...settings.madohomuSections.map((section) => ({
      kind: "custom" as const,
      id: section.id,
      title: section.name,
      threads: [] as T[],
    })),
    { kind: "working", id: "working", title: "Working", threads: [] },
    { kind: "scratch", id: "scratch", title: MADOHOMU_SCRATCH_LABEL, threads: [] },
    { kind: "snoozed", id: "snoozed", title: "Snoozed", threads: [] },
    { kind: "settled", id: "settled", title: "Settled", threads: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const group = (id: string) => byId.get(id)!;
  for (const thread of threads) {
    const entry = settings.madohomuThreads[thread.id];
    if (effectiveSnoozed(thread, options)) group("snoozed").threads.push(thread);
    else if (isShelvedSettled(thread)) group("settled").threads.push(thread);
    else if (!isMadoHomuThreadPinned(entry))
      group(
        settings.madohomuWorkingPlacement === "section" && working(thread) ? "working" : "scratch",
      ).threads.push(thread);
    else {
      const custom = entry?.section ? byId.get(entry.section) : undefined;
      (custom?.kind === "custom" ? custom : group("pinned")).threads.push(thread);
    }
  }
  const position = new Map(settings.madohomuThreadOrder.map((id, index) => [id, index]));
  for (const { kind, threads: members } of groups) {
    // Manual sections never re-sort on activity: a row that jumps when a turn ends is a moving target.
    const manual = kind === "pinned" || kind === "custom";
    members.sort(
      (a, b) =>
        (manual
          ? (position.get(a.id) ?? -1) - (position.get(b.id) ?? -1) ||
            b.createdAt.localeCompare(a.createdAt)
          : (kind === "scratch" ? Number(working(b)) - Number(working(a)) : 0) ||
            b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id),
    );
  }
  return groups;
}

/** The new `madohomuThreadOrder` after dropping `moved` before `before` (null drops it last). */
export function reorderMadoHomuThreads(
  visibleOrder: ReadonlyArray<ThreadId>,
  moved: ThreadId,
  before: ThreadId | null,
): ThreadId[] {
  const rest = visibleOrder.filter((id) => id !== moved);
  const index = before === null ? -1 : rest.indexOf(before);
  return index < 0 ? [...rest, moved] : [...rest.slice(0, index), moved, ...rest.slice(index)];
}

/**
 * The project threads MadoHomu lists. Subagents report to their parent, so only ones the user
 * filed get a row, as in T3 Code, plus the open thread so it always has its row.
 */
export function madohomuListedThreads<T extends Pick<EnvironmentThreadShell, "id" | "lineage">>(
  projectThreads: ReadonlyArray<T>,
  settings: Pick<ServerSettings, "madohomuThreads">,
  openThreadId: ThreadId | null | undefined,
): T[] {
  return projectThreads.filter(
    (thread) =>
      thread.lineage.relationshipToParent !== "subagent" ||
      settings.madohomuThreads[thread.id] !== undefined ||
      thread.id === openThreadId,
  );
}

/** The thread MadoHomu shows: the one the URL names if it is listed, else the first row. */
export function selectMadoHomuThread<T extends { readonly id: ThreadId }>(
  groups: ReadonlyArray<MadoHomuGroup<T>>,
  openThreadId: ThreadId | null | undefined,
): T | null {
  const rows = groups.flatMap((group) => group.threads);
  return rows.find((thread) => thread.id === openThreadId) ?? rows[0] ?? null;
}

/** The title MadoHomu's "New thread" gives the threads it makes. */
export const MADOHOMU_NEW_THREAD_TITLE = "New thread";

/**
 * An untouched thread MadoHomu's "New thread" made (default title, no messages, no run, no icon
 * or prompt, still pinned), so "New thread" reopens it instead of making another empty one.
 */
export function findUntouchedMadoHomuThread<
  T extends Pick<EnvironmentThreadShell, "id" | "title" | "latestUserMessageAt" | "latestRun">,
>(
  pinned: ReadonlyArray<T>,
  settings: Pick<ServerSettings, "madohomuThreads">,
): T | undefined {
  return pinned.find((thread) => {
    const entry = settings.madohomuThreads[thread.id];
    return (
      thread.title === MADOHOMU_NEW_THREAD_TITLE &&
      thread.latestUserMessageAt === null &&
      thread.latestRun === null &&
      isMadoHomuThreadPinned(entry) &&
      !entry?.icon &&
      !entry?.prompt
    );
  });
}

/** Whether the T3 Code thread list shows a thread of the MadoHomu project. */
export function isMadoHomuThreadShownInCode(
  settings: Pick<
    ServerSettings,
    "madohomuEnabled" | "madohomuProjectId" | "madohomuThreads" | "madohomuCodeVisibility"
  >,
  thread: Pick<EnvironmentThreadShell, "id" | "projectId">,
): boolean {
  if (!settings.madohomuEnabled || thread.projectId !== settings.madohomuProjectId) return true;
  if (settings.madohomuCodeVisibility === "all") return true;
  if (settings.madohomuCodeVisibility === "hidden") return false;
  return !isMadoHomuThreadPinned(settings.madohomuThreads[thread.id]);
}

/**
 * Drops the threads MadoHomu keeps out of T3 Code's thread lists, reading each
 * thread's environment settings. `isOpenThread` keeps the thread on screen listed.
 */
export function filterMadoHomuCodeThreads<
  T extends Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">,
>(
  threads: ReadonlyArray<T>,
  settingsByEnvironment: ReadonlyMap<
    EnvironmentId,
    Parameters<typeof isMadoHomuThreadShownInCode>[0]
  >,
  isOpenThread: (thread: T) => boolean = () => false,
): ReadonlyArray<T> {
  const hides = [...settingsByEnvironment.values()].some(
    (settings) => settings.madohomuEnabled && settings.madohomuCodeVisibility !== "all",
  );
  if (!hides) return threads;
  return threads.filter((thread) => {
    if (isOpenThread(thread)) return true;
    const settings = settingsByEnvironment.get(thread.environmentId);
    return settings === undefined || isMadoHomuThreadShownInCode(settings, thread);
  });
}

export const MADOHOMU_ICON_COLORS = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
] as const;

export function madohomuIconColor(threadId: string, color?: string | null): string {
  if (color) return color;
  const index =
    [...threadId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % MADOHOMU_ICON_COLORS.length;
  return MADOHOMU_ICON_COLORS[index]!;
}
/** New MadoHomu threads start in the same permission mode as any new thread in the project. */
export function madohomuRuntimeMode(
  settings: ServerSettings,
  project: LegacyProjectSettingsFields & { readonly id: ProjectId },
): RuntimeMode {
  return resolveProjectSettings(settings, project.id, project).settings.defaultRuntimeMode;
}

export const MORNING_BRIEF_PROMPT =
  "Prepare the user's morning brief for this project. Summarise what is in progress, what needs the user's decision, and propose next steps. Do not carry out those steps or make changes. Ask for approval before acting.";

export function findMadoHomuMorningBriefThread<
  T extends Pick<
    EnvironmentThreadShell,
    "id" | "environmentId" | "projectId" | "title" | "deletedAt" | "archivedAt"
  >,
>(
  threads: ReadonlyArray<T>,
  environmentId: EnvironmentId,
  projectId: ProjectId,
  taskThreadId: ThreadId | null,
): T | undefined {
  const available = threads.filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === projectId &&
      thread.deletedAt === null &&
      thread.archivedAt === null,
  );
  return (
    available.find((thread) => thread.id === taskThreadId) ??
    available.find((thread) => thread.title === "Morning brief")
  );
}

export function madohomuMorningBriefInput(input: {
  readonly id: ScheduledTaskId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly timeOfDay: string;
  readonly creationSource: "web" | "mobile";
}): ScheduledTaskUpsertInput {
  return {
    id: input.id,
    title: "Morning brief",
    prompt: MORNING_BRIEF_PROMPT,
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: input.timeOfDay },
    projectId: input.projectId,
    threadId: input.threadId,
    threadMode: "continue",
    workspaceStrategy: { type: "root" },
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: "plan",
    creationSource: input.creationSource,
  };
}

export function selectMadoHomuEnvironment(
  primary: EnvironmentId | null,
  environments: ReadonlyArray<{
    environmentId: EnvironmentId;
    madohomuEnabled: boolean;
    madohomuDesktopAppEnabled: boolean;
  }>,
): EnvironmentId | null {
  const enabled = environments.filter((environment) => environment.madohomuEnabled);
  return (
    enabled.find((e) => e.environmentId === primary && e.madohomuDesktopAppEnabled)
      ?.environmentId ??
    enabled.find((e) => e.madohomuDesktopAppEnabled)?.environmentId ??
    enabled.find((e) => e.environmentId === primary)?.environmentId ??
    enabled[0]?.environmentId ??
    null
  );
}
