import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { FEATURE_OFFERS } from "@t3tools/client-runtime/feature-offers";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function WorkAssistancePicker({
  value,
  onChange,
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
  readonly value: ServerSettings["workAssistanceTarget"];
  readonly onChange: (value: ServerSettings["workAssistanceTarget"]) => void;
}) {
  const { environments: connected } = useEnvironments();
  const environments = connected.filter((entry) => entry.environmentId === environmentId);
  const projects = useProjects();
  const [chosenEnvironment, setChosenEnvironment] = useState(
    value?.environmentId ?? environments[0]?.environmentId ?? null,
  );
  return (
    <div className="grid gap-3">
      <Select
        value={chosenEnvironment}
        onValueChange={(id) => {
          const environment = environments.find((entry) => entry.environmentId === id);
          if (environment) {
            setChosenEnvironment(environment.environmentId);
            onChange(null);
          }
        }}
      >
        <SelectTrigger aria-label="Work assistance environment">
          <SelectValue placeholder="Choose an environment">
            {environments.find((entry) => entry.environmentId === chosenEnvironment)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {environments.map((environment) => (
            <SelectItem key={environment.environmentId} value={environment.environmentId}>
              {environment.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select
        value={value?.projectId ?? null}
        onValueChange={(id) => {
          const project = projects.find(
            (entry) => entry.environmentId === chosenEnvironment && entry.id === id,
          );
          if (project) onChange({ environmentId: project.environmentId, projectId: project.id });
        }}
      >
        <SelectTrigger aria-label="Work assistance project">
          <SelectValue placeholder="Choose a project">
            {
              projects.find(
                (entry) =>
                  entry.environmentId === chosenEnvironment && entry.id === value?.projectId,
              )?.title
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {projects
            .filter((project) => project.environmentId === chosenEnvironment)
            .map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.title}
              </SelectItem>
            ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

export function DeviceNamesSettings({
  environmentId,
  currentOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly currentOnly?: boolean;
}) {
  const query = useEnvironmentQuery(serverEnvironment.messageDevices({ environmentId, input: {} }));
  const settings = useEnvironmentSettings(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const known = currentOnly
    ? query.data?.current
      ? [query.data.current]
      : []
    : (query.data?.devices ?? []);
  const devices = [
    ...known,
    ...(!currentOnly ? (query.data?.rules ?? settings.deviceNames) : []),
  ].filter(
    (device, index, all) =>
      all.findIndex(
        (entry) =>
          JSON.stringify({ ...entry, name: undefined, deviceName: undefined }) ===
          JSON.stringify({ ...device, name: undefined, deviceName: undefined }),
      ) === index,
  );
  return (
    <div className="grid gap-3">
      {devices.map((device, index) => {
        const { deviceName: _deviceName, ...identity } = device as typeof device & {
          readonly deviceName?: string;
        };
        const { name: _name, ...match } = identity as typeof identity & { readonly name?: string };
        const current = settings.deviceNames.find((rule) =>
          Object.entries(match).every(([key, value]) => rule[key as keyof typeof rule] === value),
        );
        return (
          <label key={JSON.stringify(match)} className="grid gap-1 text-sm">
            <span>
              {[match.surface, match.os, match.deviceModel, match.browser]
                .filter(Boolean)
                .join(" · ") || `Device ${index + 1}`}
            </span>
            <Input
              key={current?.name ?? ""}
              disabled={!canWrite}
              aria-label="Device name"
              maxLength={40}
              defaultValue={current?.name ?? _deviceName ?? _name ?? ""}
              placeholder="Name this device"
              onBlur={(event) => {
                const name = event.target.value.trim();
                const others = settings.deviceNames.filter((entry) => entry !== current);
                void update({
                  environmentId,
                  input: {
                    patch: { deviceNames: [{ ...match, name }, ...others] },
                  },
                });
              }}
            />
          </label>
        );
      })}
      {query.error ? <p>{query.error}</p> : null}
      {!devices.length ? (
        <p className="text-sm text-muted-foreground">
          Devices appear after they connect to this server.
        </p>
      ) : null}
    </div>
  );
}

export function BehaviorSettingsSection() {
  const { targets, scope } = useSettingsScope();
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const environmentId =
    targets.length === 1 && (scope.kind === "all" || scope.kind === "environment")
      ? targets[0]?.environmentId
      : undefined;
  const rows = FEATURE_OFFERS.filter(
    (offer) =>
      offer.page === 2 &&
      offer.setting &&
      ![
        "preferNativeSubagents",
        "threadTitleIdPrefix",
        "threadTitleIncludeProjectName",
        "buildToolsSettingsVisible",
      ].includes(offer.setting),
  );
  return (
    <>
      <SettingsSection title="Extra features">
        {rows.map((offer) => {
          const key = offer.setting!;
          if (key === "connectDeviceLongSessions" || key === "claudeHoldBackgroundCommands")
            return null;
          return (
            <SettingsRow
              key={offer.id}
              title={offer.title}
              description={offer.description}
              serverScoped
              settingKeys={[key]}
              control={
                <Checkbox
                  checked={settings[key] === (offer.enabledValue ?? true)}
                  onCheckedChange={(checked) =>
                    update({
                      [key]: checked ? (offer.enabledValue ?? true) : !(offer.enabledValue ?? true),
                    })
                  }
                />
              }
            />
          );
        })}
      </SettingsSection>
      {environmentId ? (
        <EnvironmentBehaviorSettings environmentId={environmentId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Select one environment to configure work assistance and device names.
        </p>
      )}
    </>
  );
}

function EnvironmentBehaviorSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    serverEnvironment.buildToolsState({ environmentId, input: {} }),
  );
  const [choosingWork, setChoosingWork] = useState(false);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Background Git is currently {query.data?.backgroundGitEnabled ? "on" : "off"}.
        {query.data?.backgroundGitOverridden
          ? " T3CODE_BACKGROUND_GIT overrides the saved choice."
          : query.data && query.data.backgroundGitEnabled !== settings.backgroundGitEnabled
            ? " Restart to apply your saved choice."
            : " Restart to apply changes."}
      </p>
      <SettingsSection title="Work assistance">
        <SettingsRow
          title="Enable work assistance"
          description="Choose the project and environment whose work can receive assistance."
          control={
            <Checkbox
              disabled={!canWrite}
              checked={choosingWork || settings.workAssistanceTarget !== null}
              onCheckedChange={(checked) => {
                setChoosingWork(Boolean(checked));
                if (!checked)
                  void update({ environmentId, input: { patch: { workAssistanceTarget: null } } });
              }}
            />
          }
        />
        {choosingWork || settings.workAssistanceTarget ? (
          <WorkAssistancePicker
            environmentId={environmentId}
            value={settings.workAssistanceTarget}
            onChange={(workAssistanceTarget) =>
              void update({ environmentId, input: { patch: { workAssistanceTarget } } })
            }
          />
        ) : null}
      </SettingsSection>
      <SettingsSection title="Device names">
        <DeviceNamesSettings environmentId={environmentId} />
      </SettingsSection>
    </>
  );
}
