import { createFileRoute } from "@tanstack/react-router";

import { BuildingHomuSettingsPanel } from "../components/settings/HomuCodeSettings";

export const Route = createFileRoute("/_chat/settings/building-homu")({
  component: BuildingHomuSettingsPanel,
});
