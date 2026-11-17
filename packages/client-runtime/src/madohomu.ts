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
import { effectiveSnoozed, isShelvedSettled, type ThreadSnoozeShell } from "./state/threadSettled.ts";

export function isMadoHomuThreadPinned(entry: MadoHomuThreadSettings | undefined): boolean {
  return entry !== undefined && entry.pinned !== false;
}

export function orderMadoHomuThreads<T extends Pick<EnvironmentThreadShell, "id" | "updatedAt">>(
  threads: ReadonlyArray<T>,
  entries: Readonly<Record<ThreadId, MadoHomuThreadSettings>>,
): T[] {
  return [...threads].sort(
    (a, b) =>
      Number(isMadoHomuThreadPinned(entries[b.id])) -
        Number(isMadoHomuThreadPinned(entries[a.id])) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** The section for threads that are not pinned: made outside MadoHomu, or unpinned by the user. */
export const MADOHOMU_SCRATCH_LABEL = "Scratch";

export type MadoHomuGroupKind = "pinned" | "custom" | "scratch" | "snoozed" | "settled";
export interface MadoHomuGroup<T> {
  readonly kind: MadoHomuGroupKind;
  /** The section id for a custom section, otherwise the kind. */
  readonly id: string;
  readonly title: string;
  readonly threads: T[];
}

type MadoHomuGroupSettings = Pick<
  ServerSettings,
  "madohomuThreads" | "madohomuSections" | "madohomuThreadOrder"
>;

/** The one grouping web and mobile both render: Pinned, custom sections, Scratch, Snoozed, Settled. */
export function groupMadoHomuThreads<
  T extends Pick<EnvironmentThreadShell, "id" | "updatedAt" | "settledOverride" | "runtime"> &
    ThreadSnoozeShell,
>(
  threads: ReadonlyArray<T>,
  settings: MadoHomuGroupSettings,
  options: { readonly now: string },
): MadoHomuGroup<T>[] {
  const groups: MadoHomuGroup<T>[] = [
    { kind: "pinned", id: "pinned", title: "Pinned", threads: [] },
    ...settings.madohomuSections.map((section) => ({
      kind: "custom" as const,
      id: section.id,
      title: section.name,
      threads: [] as T[],
    })),
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
    else if (!isMadoHomuThreadPinned(entry)) group("scratch").threads.push(thread);
    else {
      const custom = entry?.section ? byId.get(entry.section) : undefined;
      (custom?.kind === "custom" ? custom : group("pinned")).threads.push(thread);
    }
  }
  const position = new Map(settings.madohomuThreadOrder.map((id, index) => [id, index]));
  for (const { kind, threads: members } of groups) {
    const manual = kind === "pinned" || kind === "custom";
    members.sort(
      (a, b) =>
        (manual ? (position.get(a.id) ?? -1) - (position.get(b.id) ?? -1) : 0) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
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

type MadoHomuTask = Pick<
  EnvironmentThreadShell,
  "id" | "hasPendingApprovals" | "hasPendingUserInput" | "updatedAt"
> & { readonly runtime: Pick<NonNullable<EnvironmentThreadShell["runtime"]>, "status"> | null };

export function madohomuTaskLabel(thread: MadoHomuTask): string {
  if (thread.hasPendingApprovals) return "Needs approval";
  if (thread.hasPendingUserInput) return "Needs input";
  if (
    thread.runtime &&
    ["queued", "preparing", "starting", "running"].includes(thread.runtime.status)
  ) {
    return "Running";
  }
  return "Recent";
}

export function orderMadoHomuTasks<T extends MadoHomuTask>(threads: ReadonlyArray<T>): T[] {
  const rank = (thread: T) => {
    const label = madohomuTaskLabel(thread);
    return label === "Needs approval" || label === "Needs input" ? 0 : label === "Running" ? 1 : 2;
  };
  return [...threads].sort(
    (a, b) =>
      rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
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
