import { msg, useGT, useMessages } from "gt-react-native";
import { useAtomValue } from "@effect/atom-react";
import { AgentMemorySettings, isManagedSettingPath, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const LIMITS = [
  ["perAgentHighBytes", msg("Per-agent throttle (bytes)")],
  ["perAgentMaxBytes", msg("Per-agent cap (bytes)")],
  ["groupHighBytes", msg("Group throttle (bytes)")],
  ["groupMaxBytes", msg("Group cap (bytes)")],
  ["minimumReservationBytes", msg("Minimum reservation (bytes)")],
  ["headroomPercent", msg("Reservation headroom (%)")],
  ["pollIntervalMs", msg("Poll interval (ms)")],
] as const;

export function MobileAgentMemorySettings(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const { environmentId, label } = props;
  const config = useEnvironmentServerConfig(environmentId);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings);
  if (!config) return null;
  const memory = config.settings.agentMemory;
  const disabled = (key: keyof AgentMemorySettings) =>
    !canWrite || isManagedSettingPath(config.managedPolicy, `agentMemory.${key}`);
  const write = (agentMemory: Partial<AgentMemorySettings>) =>
    void update({ environmentId, input: { patch: { agentMemory } } });

  return (
    <SettingsSection title={gt("Agent memory controls · {label}", { label })}>
      <SettingsSwitchRow
        label={gt("Enable memory controls")}
        subtitle={gt("Limit memory for new agents on Linux with systemd and cgroups v2.")}
        value={memory.enabled}
        disabled={disabled("enabled")}
        onValueChange={(enabled) => write({ enabled })}
      />
      {LIMITS.map(([key, label]) => {
        const isValid = Schema.is(AgentMemorySettings.fields[key]);
        return (
          <MemoryLimitField
            key={key}
            label={resolve(label)}
            value={memory[key]}
            automatic={isValid(null)}
            disabled={disabled(key)}
            onCommit={(value) => {
              if (isValid(value) && value !== memory[key]) write({ [key]: value });
            }}
          />
        );
      })}
    </SettingsSection>
  );
}

function MemoryLimitField(props: {
  readonly label: string;
  readonly value: number | null;
  readonly automatic: boolean;
  readonly disabled: boolean;
  readonly onCommit: (value: number | null) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View className="gap-2 px-4 py-3">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        keyboardType="number-pad"
        editable={!props.disabled}
        value={draft ?? props.value?.toString() ?? ""}
        placeholder={props.automatic ? gt("Automatic") : ""}
        onChangeText={setDraft}
        onEndEditing={() => {
          setDraft(null);
          if (draft !== null) {
            props.onCommit(draft.trim() === "" ? null : Number(draft));
          }
        }}
        className="min-h-12 rounded-xl bg-subtle p-3 text-base text-foreground"
      />
    </View>
  );
}
