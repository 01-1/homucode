import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { TextInput, View } from "react-native";
import {
  type BuildToolsRequest,
  type EnvironmentId,
  type ModelSelection,
  type ServerConfig,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  FEATURE_OFFERS,
  getBuildToolsUnavailableReason,
  getHomuSettingUnavailableReason,
  getHomuSetupSupport,
} from "@t3tools/client-runtime/feature-offers";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { buildModelOptions } from "../../lib/modelOptions";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

function MobileWorkAssistancePicker({
  value,
  onChange,
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
  readonly value: ServerSettings["workAssistanceTarget"];
  readonly onChange: (value: ServerSettings["workAssistanceTarget"]) => void;
}) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  return (
    <View className="gap-2">
      {projects
        .filter((project) => project.environmentId === environmentId)
        .map((project) => (
          <ListChoiceRow
            key={`${project.environmentId}:${project.id}`}
            label={project.title}
            description={
              environments.find((entry) => entry.environmentId === project.environmentId)?.label ??
              project.environmentId
            }
            selected={
              value?.environmentId === project.environmentId && value.projectId === project.id
            }
            onPress={() =>
              onChange({ environmentId: project.environmentId, projectId: project.id })
            }
          />
        ))}
      {projects.length === 0 ? <Text>Connect an environment and add a project first.</Text> : null}
    </View>
  );
}

/** Saved on the phone and sent to every server, so naming needs no server support. */
export function MobileThisDeviceName() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferencesResult)) return null;
  const name = preferencesResult.value.deviceName ?? "";
  return (
    <View className="gap-1">
      <Text>Phone name</Text>
      <TextInput
        accessibilityLabel="Phone name"
        defaultValue={name}
        placeholder="Name this device"
        maxLength={40}
        className="rounded-lg border border-border p-3 text-foreground"
        onChangeText={(text) => savePreferences({ deviceName: text.trim() })}
      />
      <Text className="text-foreground-muted">
        Agents on every server see this name, unless a server names this device itself.
      </Text>
    </View>
  );
}

export function MobileDeviceNames({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useEnvironmentServerConfig(environmentId);
  const settings = config?.settings;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const unsupported = getHomuSettingUnavailableReason(config?.environment, "deviceNames");
  const reason = getHomuSettingUnavailableReason(config?.environment, "deviceNames", {
    canWrite,
    managedPolicy: config?.managedPolicy,
  });
  const query = useEnvironmentQuery(
    unsupported ? null : serverEnvironment.messageDevices({ environmentId, input: {} }),
  );
  if (unsupported) return <Text className="text-foreground-muted">{unsupported}</Text>;
  const devices = [...(query.data?.devices ?? []), ...(query.data?.rules ?? [])].filter(
    (device, index, all) =>
      all.findIndex(
        (entry) =>
          JSON.stringify({ ...entry, name: undefined, deviceName: undefined }) ===
          JSON.stringify({ ...device, name: undefined, deviceName: undefined }),
      ) === index,
  );
  return (
    <View className="gap-3">
      {reason ? <Text className="text-foreground-muted">{reason}</Text> : null}
      {devices.map((entry) => {
        const {
          deviceName: _name,
          name: _ruleName,
          ...device
        } = entry as typeof entry & { deviceName?: string; name?: string };
        const rule = settings?.deviceNames.find((entry) =>
          Object.entries(device).every(
            ([key, value]) => entry[key as keyof typeof entry] === value,
          ),
        );
        return (
          <View key={JSON.stringify(device)} className="gap-1">
            <Text>
              {[device.surface, device.os, device.deviceModel, device.browser]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <TextInput
              accessibilityLabel="Device name"
              editable={!reason}
              key={rule?.name ?? ""}
              defaultValue={rule?.name ?? _name ?? _ruleName ?? ""}
              placeholder="Name this device"
              maxLength={40}
              className="rounded-lg border border-border p-3 text-foreground"
              onEndEditing={(event) => {
                if (reason) return;
                const name = event.nativeEvent.text.trim();
                const others = settings?.deviceNames.filter((entry) => entry !== rule) ?? [];
                void update({
                  environmentId,
                  input: {
                    patch: { deviceNames: [{ ...device, name }, ...others] },
                  },
                });
              }}
            />
          </View>
        );
      })}
      {query.error ? (
        <Text className="text-foreground-muted">
          {
            "Couldn't load devices from this server. If it runs an older HomuCode, restart it to update."
          }
        </Text>
      ) : null}
    </View>
  );
}

export function MobileBuildVisibility({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const reason = getHomuSettingUnavailableReason(config?.environment, "buildToolsSettingsVisible", {
    canWrite,
    managedPolicy: config?.managedPolicy,
  });
  return (
    <SettingsSwitchRow
      label="Show Building Homu settings"
      subtitle={
        reason ?? "Configure cloud builds, APK builds and loading AppImages on this environment."
      }
      disabled={reason !== null}
      value={config?.settings.buildToolsSettingsVisible ?? false}
      onValueChange={(buildToolsSettingsVisible) => {
        if (reason) return;
        void update({ environmentId, input: { patch: { buildToolsSettingsVisible } } });
      }}
    />
  );
}

function MobileQuickModelSetting({
  config,
  reason,
  onChange,
}: {
  readonly config: ServerConfig;
  readonly reason: string | null;
  readonly onChange: (selection: ModelSelection | null) => void;
}) {
  const disabled = reason !== null;
  const [open, setOpen] = useState(false);
  const selection = config.settings.quickModelSelection;
  const models = buildModelOptions(config, selection, undefined, null);
  const selected = models.find(
    (model) =>
      model.selection.instanceId === selection?.instanceId &&
      model.selection.model === selection.model,
  );
  const choose = (next: ModelSelection | null) => {
    if (disabled) return;
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <ListActionRow
        label="Quick model"
        description={reason ?? "Choose the model used by /q on web and desktop."}
        detail={selected?.label ?? selection?.model ?? "Off"}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Sheet title="Quick model" onClose={() => setOpen(false)}>
          <ScreenScrollView>
            <ListChoiceRow
              label="Off"
              selected={selection === null}
              disabled={disabled}
              onPress={() => choose(null)}
            />
            {models.map((model) => (
              <ListChoiceRow
                key={model.key}
                label={model.label}
                description={model.providerLabel}
                selected={selected?.key === model.key}
                disabled={disabled || model.isUnavailable || model.isHidden}
                separated
                onPress={() => choose(model.selection)}
              />
            ))}
            {models.length === 0 ? <Text>No models are available on this environment.</Text> : null}
          </ScreenScrollView>
        </Sheet>
      ) : null}
    </>
  );
}

export function MobileExtraSettings({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const buildStatusReason = getBuildToolsUnavailableReason(config?.environment, canWrite);
  const query = useEnvironmentQuery(
    buildStatusReason ? null : serverEnvironment.buildToolsState({ environmentId, input: {} }),
  );
  const canSetLongSessions = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: { connectDeviceLongSessions: true },
    }),
  );
  if (!config) return null;
  const { settings } = config;
  const permissions = {
    canWrite,
    canWriteAccess: canSetLongSessions,
    managedPolicy: config.managedPolicy,
  };
  const { unavailableFeatureReasons } = getHomuSetupSupport(config.environment, permissions);
  const workAssistanceReason = getHomuSettingUnavailableReason(
    config.environment,
    "workAssistanceTarget",
    permissions,
  );
  return (
    <SettingsSection title={`Extra features · ${label}`}>
      <MobileQuickModelSetting
        config={config}
        reason={unavailableFeatureReasons.get("quick-model") ?? null}
        onChange={(quickModelSelection) =>
          void update({ environmentId, input: { patch: { quickModelSelection } } })
        }
      />
      {FEATURE_OFFERS.filter(
        (offer) =>
          offer.page === 2 && offer.setting && offer.setting !== "buildToolsSettingsVisible",
      ).map((offer) => {
        const key = offer.setting!;
        const reason = unavailableFeatureReasons.get(offer.id);
        return (
          <SettingsSwitchRow
            key={offer.id}
            label={
              offer.id === "subagents"
                ? "Use Homu delegation (delegate_task)"
                : offer.id === "thread-only-stop"
                  ? "Stop stops only this thread"
                  : offer.title
            }
            subtitle={
              reason ??
              (key === "claudeHoldBackgroundCommands"
                ? "Keep Claude threads working until background commands finish or the agent releases them."
                : offer.description)
            }
            value={settings[key] === (offer.enabledValue ?? true)}
            disabled={reason !== undefined}
            onValueChange={(checked) => {
              if (reason) return;
              void update({
                environmentId,
                input: {
                  patch: {
                    [key]: checked ? (offer.enabledValue ?? true) : !(offer.enabledValue ?? true),
                  },
                },
              });
            }}
          />
        );
      })}
      <Text>
        {query.data
          ? `Background Git is currently ${query.data.backgroundGitEnabled ? "on" : "off"}. ${
              query.data.backgroundGitOverridden
                ? "T3CODE_BACKGROUND_GIT overrides the saved choice."
                : query.data.backgroundGitEnabled !== settings.backgroundGitEnabled
                  ? "Restart to apply your saved choice."
                  : "Restart to apply changes."
            }`
          : `Background Git status · ${buildStatusReason ?? query.error ?? "Loading…"}`}
      </Text>
      <Text>Work assistance (not recommended)</Text>
      <Text className="text-foreground-muted">
        Untested. Lets a signed-in local t3 client add a helper agent to a thread in this project
        that has worked nonstop for over 5 minutes. HomuCode never starts helpers by itself.
      </Text>
      {workAssistanceReason ? (
        <Text className="text-foreground-muted">{workAssistanceReason}</Text>
      ) : (
        <>
          <MobileWorkAssistancePicker
            environmentId={environmentId}
            value={settings.workAssistanceTarget}
            onChange={(workAssistanceTarget) =>
              void update({ environmentId, input: { patch: { workAssistanceTarget } } })
            }
          />
          <Button
            label="Turn off work assistance"
            disabled={!settings.workAssistanceTarget}
            onPress={() =>
              void update({ environmentId, input: { patch: { workAssistanceTarget: null } } })
            }
          />
        </>
      )}
      <Text>Device names</Text>
      <MobileDeviceNames environmentId={environmentId} />
    </SettingsSection>
  );
}

export function SettingsBuildingT3RouteScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title="Building Homu">
      <ScreenScrollView contentContainerClassName="gap-6 p-5">
        {selectedTargets
          .filter((target) => target.serverConfig?.settings.buildToolsSettingsVisible)
          .map((target) => (
            <SettingsSection key={target.environmentId} title={target.label}>
              <MobileBuildTools environmentId={target.environmentId} />
            </SettingsSection>
          ))}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

export function MobileBuildTools({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useEnvironmentServerConfig(environmentId);
  const settings = config?.settings;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const run = useAtomCommand(serverEnvironment.buildToolsRun);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canRun = useAtomValue(serverEnvironment.buildToolsRun.permissionAtom(environmentId));
  const reason = getBuildToolsUnavailableReason(config?.environment, canWrite);
  const query = useEnvironmentQuery(
    reason ? null : serverEnvironment.buildToolsState({ environmentId, input: {} }),
  );
  const [ref, setRef] = useState("origin/main");
  const [testFile, setTestFile] = useState("");
  const [stagedFile, setStagedFile] = useState("");
  const [sha256, setSha256] = useState("");
  const [confirm, setConfirm] = useState<BuildToolsRequest["action"] | null>(null);
  const action = (action: BuildToolsRequest["action"]) => {
    if (reason || !canRun || query.error) return;
    void run({
      environmentId,
      input: {
        action,
        ref,
        testFiles: testFile.trim() ? [testFile.trim()] : [],
        stagedFile,
        sha256,
        undoneAs: query.data?.undoneAs ?? "",
      },
    });
  };
  const actionsDisabled = !canRun || Boolean(query.error);
  const busy = query.data?.phase === "running";
  if (reason) return <Text>{reason}</Text>;
  if (!settings) return null;
  return (
    <View className="gap-4">
      {!canRun ? <Text>This connection cannot run build tools.</Text> : null}
      {(
        [
          ["buildRepoPath", "HomuCode checkout"],
          ["buildBoatCliPath", "Boat CLI"],
          ["buildMachineType", "Cloud machine type"],
          ["buildOutputFolder", "Build output folder"],
          ["buildAppImageFolder", "AppImage build folder"],
        ] as const
      ).map(([key, label]) => (
        <View key={key}>
          <Text>{label}</Text>
          <TextInput
            key={settings[key]}
            defaultValue={settings[key]}
            accessibilityLabel={label}
            editable={canWrite && !busy}
            className="rounded-lg border border-border p-3 text-foreground"
            onEndEditing={(event) =>
              void update({ environmentId, input: { patch: { [key]: event.nativeEvent.text } } })
            }
          />
        </View>
      ))}
      <Text>
        Build folder: {query.data?.buildFolder}. The loader starts the newest AppImage here.
      </Text>
      <Text>
        {query.data?.stagedBuilds
          ? `Running ${query.data.stagedBuilds.running}; next ${query.data.stagedBuilds.next ?? "none"}`
          : "Staged builds are not available on this installation."}
      </Text>
      <Button
        label="Undo a staged build"
        disabled={actionsDisabled || !query.data?.stagedBuilds?.previous}
        onPress={() => action("undo")}
      />
      {query.data?.undoneAs ? (
        <Button
          label="Redo staged build"
          disabled={actionsDisabled}
          onPress={() => action("redo")}
        />
      ) : null}
      {(
        [
          ["cloudBuildEnabled", "Enable cloud builds"],
          ["androidBuildEnabled", "Enable Android APK builds"],
          ["loadBuildEnabled", "Enable loading AppImages"],
        ] as const
      ).map(([key, label]) => (
        <SettingsSwitchRow
          key={key}
          label={label}
          value={settings[key]}
          disabled={
            !canWrite || busy || (key === "loadBuildEnabled" && !query.data?.appImageAvailable)
          }
          onValueChange={(value) =>
            void update({ environmentId, input: { patch: { [key]: value } } })
          }
        />
      ))}
      <Text>Install boat and run boat login on the server before building.</Text>
      <TextInput
        accessibilityLabel="Build revision"
        value={ref}
        onChangeText={setRef}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <TextInput
        accessibilityLabel="Focused test file"
        value={testFile}
        onChangeText={setTestFile}
        placeholder="Focused test file"
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <Button
        label="Build AppImage"
        disabled={actionsDisabled || busy || !settings.cloudBuildEnabled}
        onPress={() => setConfirm("cloud-build")}
      />
      <Button
        label="Run focused tests"
        disabled={actionsDisabled || busy || !settings.cloudBuildEnabled || !testFile.trim()}
        onPress={() => setConfirm("cloud-test")}
      />
      <Button
        label="Build Android APK"
        disabled={actionsDisabled || busy || !settings.androidBuildEnabled}
        onPress={() => setConfirm("android")}
      />
      <SettingsSwitchRow
        label="Serve APKs on LAN"
        subtitle="Serve ~/app/mobile on port 8767 until switched off or the server stops."
        value={Boolean(query.data?.lanUrl)}
        disabled={actionsDisabled || (!settings.androidBuildEnabled && !query.data?.lanUrl)}
        onValueChange={(value) => action(value ? "serve" : "stop-serving")}
      />
      {query.data?.lanUrl ? (
        <Text selectable>
          {query.data.lanUrl}
          {query.data.artifactPath?.split("/").at(-1) ?? "<APK filename>"}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Staged AppImage"
        value={stagedFile}
        onChangeText={setStagedFile}
        placeholder="Staged AppImage path"
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <TextInput
        accessibilityLabel="SHA-256"
        value={sha256}
        onChangeText={setSha256}
        placeholder="SHA-256"
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <Button
        label="Load staged build"
        disabled={
          actionsDisabled ||
          busy ||
          !settings.loadBuildEnabled ||
          !query.data?.appImageAvailable ||
          !stagedFile ||
          !/^[a-f\d]{64}$/i.test(sha256)
        }
        onPress={() => setConfirm("load")}
      />
      {confirm ? (
        <View className="gap-2">
          <Text>
            {confirm === "load"
              ? "This restarts Homu, with automatic rollback if it fails to return."
              : "This starts a cloud machine on your boat.dev account."}
          </Text>
          <Button
            label="Confirm"
            disabled={actionsDisabled}
            onPress={() => {
              action(confirm);
              setConfirm(null);
            }}
          />
          <Button label="Cancel" tone="text" onPress={() => setConfirm(null)} />
        </View>
      ) : null}
      <Text selectable>{query.error ?? query.data?.message ?? "Loading status…"}</Text>
      {query.data?.artifactPath ? <Text selectable>{query.data.artifactPath}</Text> : null}
      {query.data?.output ? <Text selectable>{query.data.output}</Text> : null}
    </View>
  );
}
