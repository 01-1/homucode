import { createFileRoute } from "@tanstack/react-router";

import { HomuCodeSettingsPanel } from "../components/settings/HomuCodeSettings";

export const Route = createFileRoute("/_chat/settings/homucode")({
  component: HomuCodeSettingsPanel,
});
