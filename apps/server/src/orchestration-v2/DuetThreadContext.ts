import {
  DEFAULT_DUET_ICON,
  type ProjectId,
  type ServerSettings,
  type ThreadId,
} from "@t3tools/contracts";

export function duetThreadContext(
  settings: Pick<ServerSettings, "duetEnabled" | "duetProjectId" | "duetThreads">,
  thread: { readonly id: ThreadId; readonly projectId: ProjectId; readonly title: string },
): string {
  if (!settings.duetEnabled || settings.duetProjectId !== thread.projectId) return "";
  const entry = settings.duetThreads[thread.id];
  if (entry === undefined && thread.title.trim() === "") return "";
  return [
    `Duet thread ${JSON.stringify(thread.title)}`,
    `Icon: ${entry?.icon ?? DEFAULT_DUET_ICON}`,
    entry?.prompt.trim() ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
