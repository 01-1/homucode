import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DuetPage } from "../components/duet/DuetPage";

type DuetSearch = { environmentId?: EnvironmentId; threadId?: ThreadId; tab?: "chat" | "tasks" };

export const Route = createFileRoute("/_chat/duet")({
  validateSearch: (search: Record<string, unknown>): DuetSearch => ({
    ...(typeof search.environmentId === "string" && search.environmentId
      ? { environmentId: EnvironmentId.make(search.environmentId) }
      : {}),
    ...(typeof search.threadId === "string" && search.threadId
      ? { threadId: ThreadId.make(search.threadId) }
      : {}),
    tab: search.tab === "tasks" ? ("tasks" as const) : ("chat" as const),
  }),
  component: DuetPage,
});
