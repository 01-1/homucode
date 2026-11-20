import { createFileRoute } from "@tanstack/react-router";

import { AgentBehaviorSettingsPanel } from "../components/settings/HomuCodeSettings";

export const Route = createFileRoute("/_chat/settings/agent-behavior")({
  component: AgentBehaviorSettingsPanel,
});
