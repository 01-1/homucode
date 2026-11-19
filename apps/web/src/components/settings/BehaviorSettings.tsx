import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  managedCapabilityDenial,
  type EnvironmentId,
  type ServerSettings,
} from "@t3tools/contracts";
import { FEATURE_OFFERS } from "@t3tools/client-runtime/feature-offers";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useManagedPolicy } from "../../state/managedPolicy";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { FEATURE_OFFER_SETTINGS, searchableSetting } from "./settingsSearch";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { Switch } from "../ui/switch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

function WorkAssistancePicker({
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
  const devices = [
    ...(query.data?.current ? [query.data.current] : []),
    ...(!currentOnly ? (query.data?.devices ?? []) : []),
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
      {query.error ? (
        <p className="text-muted-foreground">
          {
            "Couldn't load devices from this server. If it runs an older Homu Code, restart it to update."
          }
        </p>
      ) : null}
      {!devices.length ? (
        <p className="text-sm text-muted-foreground">
          Devices appear after they connect to this server.
        </p>
      ) : null}
    </div>
  );
}

export function BehaviorSettingsSection() {
  const { targets, scope, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const environmentId =
    targets.length === 1 && (scope.kind === "all" || scope.kind === "environment")
      ? targets[0]?.environmentId
      : undefined;
  return (
    <>
      <SettingsSection title="Extra features">
        {FEATURE_OFFERS.map((offer) => {
          const id = FEATURE_OFFER_SETTINGS[offer.id];
          const key = offer.setting;
          if (offer.page !== 2 || !key || key === "claudeHoldBackgroundCommands" || id !== offer.id)
            return null;
          return (
            <SettingsRow
              key={offer.id}
              {...searchableSetting(id)}
              description={offer.description}
              serverScoped
              settingKeys={[key]}
              control={
                <Checkbox
                  checked={settings[key] === (offer.enabledValue ?? true)}
                  aria-label={offer.title}
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
          Select one environment to configure work assistance.
        </p>
      )}
      <SettingsSection
        title="T3 Connect"
        {...(!environmentId ? { id: "connect-device-long-sessions" } : {})}
      >
        {environmentId ? (
          <ConnectSessionSetting environmentId={environmentId} />
        ) : (
          <SettingsScopeNotice inline target="environment" targetId="connect-device-long-sessions">
            Choose an environment to change its T3 Connect session length.
          </SettingsScopeNotice>
        )}
      </SettingsSection>
      <SettingsSection {...searchableSetting("device-names")}>
        {environmentId ? (
          <DeviceNamesSettings environmentId={environmentId} />
        ) : (
          <SettingsScopeNotice
            inline
            target="environment"
            targetId="device-names"
            {...(scope.kind === "all"
              ? { eligibleEnvironmentIds: connectedEnvironments.map((env) => env.environmentId) }
              : {})}
          >
            Choose an environment to edit device names.
          </SettingsScopeNotice>
        )}
      </SettingsSection>
    </>
  );
}

function ConnectSessionSetting({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { connectDeviceLongSessions } = useEnvironmentSettings(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: { connectDeviceLongSessions: true },
    }),
  );
  const connectDenial = managedCapabilityDenial(useManagedPolicy(environmentId), "connect");
  return (
    <SettingsRow
      {...searchableSetting("connect-device-long-sessions")}
      settingKeys={["connectDeviceLongSessions"]}
      description="Let T3 Connect devices reconnect for 30 days without a cloud round trip. Revoke a device in Sharing & access to end its access."
      managed={connectDenial}
      control={
        <Switch
          aria-label="Stay signed in for 30 days"
          checked={connectDeviceLongSessions}
          disabled={!canWrite}
          onCheckedChange={(enabled) =>
            void update({ environmentId, input: { patch: { connectDeviceLongSessions: enabled } } })
          }
        />
      }
    />
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
      <SettingsSection id={searchableSetting("work-assistance").id} title="Work assistance">
        <SettingsRow
          title="Enable work assistance (not recommended)"
          description="Untested. Lets a signed-in local t3 client add a helper agent to a thread in this project that has worked nonstop for over 5 minutes. Homu Code never starts helpers by itself."
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
    </>
  );
}
