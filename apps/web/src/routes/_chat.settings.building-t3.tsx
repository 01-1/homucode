import { createFileRoute } from "@tanstack/react-router";
import { BuildToolsSettingsPanel } from "../components/settings/BuildToolsSettings";
export const Route = createFileRoute("/_chat/settings/building-t3")({
  component: BuildToolsSettingsPanel,
});
