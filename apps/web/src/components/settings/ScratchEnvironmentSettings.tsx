import type { EnvironmentId } from "@t3tools/contracts";

import {
  updateClientSettings,
  useClientSettings,
  useClientSettingsHydrated,
} from "~/hooks/useSettings";
import type { EnvironmentPresentation } from "~/state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

const AUTOMATIC = "automatic";

export function ScratchEnvironmentSettings({
  environments,
}: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const scratchEnvironmentId = useClientSettings((settings) => settings.scratchEnvironmentId);
  const settingsHydrated = useClientSettingsHydrated();

  if (environments.length < 2) return null;

  const items = [
    { value: AUTOMATIC, label: "Automatic" },
    ...environments.map((environment) => ({
      value: environment.environmentId as string,
      label: environment.label,
    })),
  ];
  const value =
    scratchEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === scratchEnvironmentId)
      ? scratchEnvironmentId
      : AUTOMATIC;

  const { id, title } = searchableSetting("scratch-environment");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={items.find((item) => item.value === value)?.label ?? null}
      control={
        <Select
          items={items}
          value={value}
          disabled={!settingsHydrated}
          onValueChange={(next) => {
            if (next === null) return;
            void updateClientSettings({
              scratchEnvironmentId: next === AUTOMATIC ? null : (next as EnvironmentId),
            });
          }}
        >
          <SelectTrigger
            size="xs"
            className="w-40"
            aria-label="Machine for threads without a project"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        Choose the machine that runs threads started without a project. Automatic uses this device's
        own machine when it has one, otherwise the machine you are working on. If the chosen machine
        is unavailable, Automatic applies. This applies only to this device.
      </p>
    </FoldedSettingsSection>
  );
}
