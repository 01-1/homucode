import { AgentMemorySettings as MemorySchema } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const LIMITS = [
  ["perAgentHighBytes", "Per-agent throttle (bytes)"],
  ["perAgentMaxBytes", "Per-agent cap (bytes)"],
  ["groupHighBytes", "Group throttle (bytes)"],
  ["groupMaxBytes", "Group cap (bytes)"],
  ["minimumReservationBytes", "Minimum reservation (bytes)"],
  ["headroomPercent", "Reservation headroom (%)"],
  ["pollIntervalMs", "Poll interval (ms)"],
] as const;

export function AgentMemorySettings() {
  const { scope, connectedEnvironments } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const environment = connectedEnvironments.length === 1 ? connectedEnvironments[0] : undefined;
  const config = environment?.serverConfig;
  const memory = useScopedSettings((settings) => settings.agentMemory);

  return (
    <SettingsSection id={searchableSetting("agent-memory").id} title="Agent memory controls">
      {(scope.kind === "all" || scope.kind === "environment") &&
      environment &&
      config?.environment.platform.os === "linux" ? (
        <>
          <SettingsRow
            title="Enable memory controls"
            description="Limit memory for new agents on Linux with systemd and cgroups v2. New agents wait when the group memory budget is full."
            serverScoped
            managedPaths={["agentMemory.enabled"]}
            control={
              <Switch
                checked={memory.enabled}
                aria-label="Enable memory controls"
                onCheckedChange={(enabled) => updateSettings({ agentMemory: { enabled } })}
              />
            }
          />
          {LIMITS.map(([key, label]) => {
            const isValid = Schema.is(MemorySchema.fields[key]);
            return (
              <SettingsRow
                key={key}
                title={label}
                serverScoped
                managedPaths={[`agentMemory.${key}`]}
                control={
                  <DraftInput
                    key={environment.environmentId}
                    aria-label={label}
                    value={memory[key]?.toString() ?? ""}
                    placeholder={isValid(null) ? "Automatic" : undefined}
                    inputMode="numeric"
                    onCommit={(draft) => {
                      const value = draft.trim() === "" ? null : Number(draft);
                      if (isValid(value) && value !== memory[key]) {
                        updateSettings({ agentMemory: { [key]: value } });
                      }
                    }}
                  />
                }
              />
            );
          })}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select one Linux environment to configure memory controls.
        </p>
      )}
    </SettingsSection>
  );
}
