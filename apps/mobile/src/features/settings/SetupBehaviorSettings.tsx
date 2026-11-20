import { msg, T, useGT, useMessages } from "gt-react-native";
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
      {projects.length === 0 ? (
        <Text>
          <T>Connect an environment and add a project first.</T>
        </Text>
      ) : null}
    </View>
  );
}

/** Saved on the phone and sent to every server, so naming needs no server support. */
export function MobileThisDeviceName() {
  const gt = useGT();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferencesResult)) return null;
  const name = preferencesResult.value.deviceName ?? "";
  return (
    <View className="gap-1">
      <Text>
        <T>Phone name</T>
      </Text>
      <TextInput
        accessibilityLabel={gt("Phone name")}
        defaultValue={name}
        placeholder={gt("Name this device")}
        maxLength={40}
        className="rounded-lg border border-border p-3 text-foreground"
        onChangeText={(text) => savePreferences({ deviceName: text.trim() })}
      />
      <Text className="text-foreground-muted">
        <T>Agents on every server see this name, unless a server names this device itself.</T>
      </Text>
    </View>
  );
}

export function MobileDeviceNames({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const resolve = useMessages();
  const config = useEnvironmentServerConfig(environmentId);
  const settings = config?.settings;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const unsupported = getHomuSettingUnavailableReason(
    config?.environment,
    "deviceNames",
    {},
    resolve,
  );
  const reason = getHomuSettingUnavailableReason(
    config?.environment,
    "deviceNames",
    {
      canWrite,
      managedPolicy: config?.managedPolicy,
    },
    resolve,
  );
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
              accessibilityLabel={gt("Device name")}
              editable={!reason}
              key={rule?.name ?? ""}
              defaultValue={rule?.name ?? _name ?? _ruleName ?? ""}
              placeholder={gt("Name this device")}
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
          {gt(
            "Couldn't load devices from this server. If it runs an older HomuCode, restart it to update.",
          )}
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
  const gt = useGT();
  const config = useEnvironmentServerConfig(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const resolve = useMessages();
  const reason = getHomuSettingUnavailableReason(
    config?.environment,
    "buildToolsSettingsVisible",
    {
      canWrite,
      managedPolicy: config?.managedPolicy,
    },
    resolve,
  );
  return (
    <SettingsSwitchRow
      label={gt("Show Building Homu settings")}
      subtitle={
        reason ??
        gt("Configure cloud builds, APK builds and loading AppImages on this environment.")
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
  const gt = useGT();
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
        label={gt("Quick model")}
        description={reason ?? gt("Choose the model used by /q on web and desktop.")}
        detail={selected?.label ?? selection?.model ?? gt("Off")}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Sheet title={gt("Quick model")} onClose={() => setOpen(false)}>
          <ScreenScrollView>
            <ListChoiceRow
              label={gt("Off")}
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
            {models.length === 0 ? (
              <Text>
                <T>No models are available on this environment.</T>
              </Text>
            ) : null}
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
  const gt = useGT();
  const config = useEnvironmentServerConfig(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const resolve = useMessages();
  const buildStatusReason = getBuildToolsUnavailableReason(config?.environment, canWrite, resolve);
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
  const { unavailableFeatureReasons } = getHomuSetupSupport(
    config.environment,
    permissions,
    resolve,
  );
  const workAssistanceReason = getHomuSettingUnavailableReason(
    config.environment,
    "workAssistanceTarget",
    permissions,
    resolve,
  );
  return (
    <SettingsSection title={gt("Extra features · {label}", { label })}>
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
                ? gt("Use Homu delegation (delegate_task)")
                : offer.id === "thread-only-stop"
                  ? gt("Stop stops only this thread")
                  : resolve(offer.title)
            }
            subtitle={
              reason ??
              (key === "claudeHoldBackgroundCommands"
                ? gt(
                    "Keep Claude threads working until background commands finish or the agent releases them.",
                  )
                : resolve(offer.description))
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
          ? gt("{status} {detail}", {
              status: query.data.backgroundGitEnabled
                ? gt("Background Git is currently on.")
                : gt("Background Git is currently off."),
              detail: query.data.backgroundGitOverridden
                ? gt("T3CODE_BACKGROUND_GIT overrides the saved choice.")
                : query.data.backgroundGitEnabled !== settings.backgroundGitEnabled
                  ? gt("Restart to apply your saved choice.")
                  : gt("Restart to apply changes."),
            })
          : gt("Background Git status · {status}", {
              status: buildStatusReason ?? query.error ?? gt("Loading…"),
            })}
      </Text>
      <Text>
        <T>Work assistance (not recommended)</T>
      </Text>
      <Text className="text-foreground-muted">
        <T>
          Untested. Lets a signed-in local t3 client add a helper agent to a thread in this project
          that has worked nonstop for over 5 minutes. HomuCode never starts helpers by itself.
        </T>
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
            label={gt("Turn off work assistance")}
            disabled={!settings.workAssistanceTarget}
            onPress={() =>
              void update({ environmentId, input: { patch: { workAssistanceTarget: null } } })
            }
          />
        </>
      )}
      <Text>
        <T>Device names</T>
      </Text>
      <MobileDeviceNames environmentId={environmentId} />
    </SettingsSection>
  );
}

export function SettingsBuildingT3RouteScreen() {
  const gt = useGT();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title={gt("Building Homu")}>
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

const SHA256_LABEL = "SHA-256";

export function MobileBuildTools({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const config = useEnvironmentServerConfig(environmentId);
  const settings = config?.settings;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const run = useAtomCommand(serverEnvironment.buildToolsRun);
  const resolve = useMessages();
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canRun = useAtomValue(serverEnvironment.buildToolsRun.permissionAtom(environmentId));
  const reason = getBuildToolsUnavailableReason(config?.environment, canWrite, resolve);
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
      {!canRun ? (
        <Text>
          <T>This connection cannot run build tools.</T>
        </Text>
      ) : null}
      {(
        [
          ["buildRepoPath", msg("HomuCode checkout")],
          ["buildBoatCliPath", msg("Boat CLI")],
          ["buildMachineType", msg("Cloud machine type")],
          ["buildOutputFolder", msg("Build output folder")],
          ["buildAppImageFolder", msg("AppImage build folder")],
        ] as const
      ).map(([key, label]) => (
        <View key={key}>
          <Text>{resolve(label)}</Text>
          <TextInput
            key={settings[key]}
            defaultValue={settings[key]}
            accessibilityLabel={resolve(label)}
            editable={canWrite && !busy}
            className="rounded-lg border border-border p-3 text-foreground"
            onEndEditing={(event) =>
              void update({ environmentId, input: { patch: { [key]: event.nativeEvent.text } } })
            }
          />
        </View>
      ))}
      <Text>
        {gt("Build folder: {folder}. The loader starts the newest AppImage here.", {
          folder: query.data?.buildFolder ?? "",
        })}
      </Text>
      <Text>
        {query.data?.stagedBuilds
          ? gt("Running {running}; next {next}", {
              running: query.data.stagedBuilds.running,
              next: query.data.stagedBuilds.next ?? gt("none"),
            })
          : gt("Staged builds are not available on this installation.")}
      </Text>
      <Button
        label={gt("Undo a staged build")}
        disabled={actionsDisabled || !query.data?.stagedBuilds?.previous}
        onPress={() => action("undo")}
      />
      {query.data?.undoneAs ? (
        <Button
          label={gt("Redo staged build")}
          disabled={actionsDisabled}
          onPress={() => action("redo")}
        />
      ) : null}
      {(
        [
          ["cloudBuildEnabled", msg("Enable cloud builds")],
          ["androidBuildEnabled", msg("Enable Android APK builds")],
          ["loadBuildEnabled", msg("Enable loading AppImages")],
        ] as const
      ).map(([key, label]) => (
        <SettingsSwitchRow
          key={key}
          label={resolve(label)}
          value={settings[key]}
          disabled={
            !canWrite || busy || (key === "loadBuildEnabled" && !query.data?.appImageAvailable)
          }
          onValueChange={(value) =>
            void update({ environmentId, input: { patch: { [key]: value } } })
          }
        />
      ))}
      <Text>
        {gt("Install {cli} and run {command} on the server before building.", {
          cli: "boat",
          command: "boat login",
        })}
      </Text>
      <TextInput
        accessibilityLabel={gt("Build revision")}
        value={ref}
        onChangeText={setRef}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <TextInput
        accessibilityLabel={gt("Focused test file")}
        value={testFile}
        onChangeText={setTestFile}
        placeholder={gt("Focused test file")}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <Button
        label={gt("Build AppImage")}
        disabled={actionsDisabled || busy || !settings.cloudBuildEnabled}
        onPress={() => setConfirm("cloud-build")}
      />
      <Button
        label={gt("Run focused tests")}
        disabled={actionsDisabled || busy || !settings.cloudBuildEnabled || !testFile.trim()}
        onPress={() => setConfirm("cloud-test")}
      />
      <Button
        label={gt("Build Android APK")}
        disabled={actionsDisabled || busy || !settings.androidBuildEnabled}
        onPress={() => setConfirm("android")}
      />
      <SettingsSwitchRow
        label={gt("Serve APKs on LAN")}
        subtitle={gt("Serve ~/app/mobile on port 8767 until switched off or the server stops.")}
        value={Boolean(query.data?.lanUrl)}
        disabled={actionsDisabled || (!settings.androidBuildEnabled && !query.data?.lanUrl)}
        onValueChange={(value) => action(value ? "serve" : "stop-serving")}
      />
      {query.data?.lanUrl ? (
        <Text selectable>
          {query.data.lanUrl}
          {query.data.artifactPath?.split("/").at(-1) ??
            gt("<{filename}>", { filename: gt("APK filename") })}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={gt("Staged AppImage")}
        value={stagedFile}
        onChangeText={setStagedFile}
        placeholder={gt("Staged AppImage path")}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <TextInput
        accessibilityLabel={SHA256_LABEL}
        value={sha256}
        onChangeText={setSha256}
        placeholder={SHA256_LABEL}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <Button
        label={gt("Load staged build")}
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
              ? gt("This restarts Homu, with automatic rollback if it fails to return.")
              : gt("This starts a cloud machine on your boat.dev account.")}
          </Text>
          <Button
            label={gt("Confirm")}
            disabled={actionsDisabled}
            onPress={() => {
              action(confirm);
              setConfirm(null);
            }}
          />
          <Button label={gt("Cancel")} tone="text" onPress={() => setConfirm(null)} />
        </View>
      ) : null}
      <Text selectable>{query.error ?? query.data?.message ?? gt("Loading status…")}</Text>
      {query.data?.artifactPath ? <Text selectable>{query.data.artifactPath}</Text> : null}
      {query.data?.output ? <Text selectable>{query.data.output}</Text> : null}
    </View>
  );
}
