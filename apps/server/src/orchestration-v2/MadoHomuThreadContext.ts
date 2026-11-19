import {
  DEFAULT_MADOHOMU_ICON,
  type ProjectId,
  type ServerSettings,
  type ThreadId,
} from "@t3tools/contracts";

export function madohomuThreadContext(
  settings: Pick<ServerSettings, "madohomuEnabled" | "madohomuProjectId" | "madohomuThreads">,
  thread: { readonly id: ThreadId; readonly projectId: ProjectId; readonly title: string },
): string {
  if (!settings.madohomuEnabled || settings.madohomuProjectId !== thread.projectId) return "";
  const entry = settings.madohomuThreads[thread.id];
  if (entry === undefined && thread.title.trim() === "") return "";
  return [
    `MadoHomu thread ${JSON.stringify(thread.title)}`,
    `T3 thread ID: ${thread.id}`,
    `Icon: ${entry?.icon ?? DEFAULT_MADOHOMU_ICON}`,
    entry?.prompt.trim() ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
