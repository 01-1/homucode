import type {
  MadoHomuThreadSettings,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ScheduledTaskId,
  ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "./state/models.ts";

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
    runtimeMode: "approval-required",
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
