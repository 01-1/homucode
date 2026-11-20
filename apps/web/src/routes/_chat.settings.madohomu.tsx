import { createFileRoute } from "@tanstack/react-router";

import { MadoHomuSettingsPanel } from "../components/settings/HomuCodeSettings";

export const Route = createFileRoute("/_chat/settings/madohomu")({
  component: MadoHomuSettingsPanel,
});
