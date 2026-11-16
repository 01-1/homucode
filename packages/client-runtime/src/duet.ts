import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "./state/models.ts";

export const DUET_ICON_COLORS = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
] as const;

export function duetIconColor(threadId: string, color?: string | null): string {
  if (color) return color;
  const index =
    [...threadId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % DUET_ICON_COLORS.length;
  return DUET_ICON_COLORS[index]!;
}
export const MORNING_BRIEF_PROMPT =
  "Prepare Homura's morning brief for this project. Summarise what is in progress, what needs Homura's decision, and propose next steps. Do not carry out those steps or make changes. Ask for approval before acting.";

type DuetTask = Pick<
  EnvironmentThreadShell,
  "id" | "hasPendingApprovals" | "hasPendingUserInput" | "updatedAt"
> & { readonly runtime: Pick<NonNullable<EnvironmentThreadShell["runtime"]>, "status"> | null };

export function duetTaskLabel(thread: DuetTask): string {
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

export function orderDuetTasks<T extends DuetTask>(threads: ReadonlyArray<T>): T[] {
  const rank = (thread: T) => {
    const label = duetTaskLabel(thread);
    return label === "Needs approval" || label === "Needs input" ? 0 : label === "Running" ? 1 : 2;
  };
  return [...threads].sort(
    (a, b) =>
      rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}

export function selectDuetEnvironment(
  primary: EnvironmentId | null,
  environments: ReadonlyArray<{
    environmentId: EnvironmentId;
    duetEnabled: boolean;
    duetDesktopAppEnabled: boolean;
  }>,
): EnvironmentId | null {
  const enabled = environments.filter((environment) => environment.duetEnabled);
  return (
    enabled.find((e) => e.environmentId === primary && e.duetDesktopAppEnabled)?.environmentId ??
    enabled.find((e) => e.duetDesktopAppEnabled)?.environmentId ??
    enabled.find((e) => e.environmentId === primary)?.environmentId ??
    enabled[0]?.environmentId ??
    null
  );
}
