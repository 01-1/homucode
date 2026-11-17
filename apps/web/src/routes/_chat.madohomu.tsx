import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MadoHomuPage } from "../components/madohomu/MadoHomuPage";

type MadoHomuSearch = {
  environmentId?: EnvironmentId;
  threadId?: ThreadId;
};

export const Route = createFileRoute("/_chat/madohomu")({
  validateSearch: (search: Record<string, unknown>): MadoHomuSearch => ({
    ...(typeof search.environmentId === "string" && search.environmentId
      ? { environmentId: EnvironmentId.make(search.environmentId) }
      : {}),
    ...(typeof search.threadId === "string" && search.threadId
      ? { threadId: ThreadId.make(search.threadId) }
      : {}),
  }),
  component: MadoHomuPage,
});
