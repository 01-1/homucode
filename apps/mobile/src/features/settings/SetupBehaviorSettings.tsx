import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { TextInput, View } from "react-native";
import type { BuildToolsRequest, EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { FEATURE_OFFERS } from "@t3tools/client-runtime/feature-offers";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
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

export function MobileDeviceNames({
  environmentId,
  currentOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly currentOnly?: boolean;
}) {
  const settings = useEnvironmentServerConfig(environmentId)?.settings;
  const query = useEnvironmentQuery(serverEnvironment.messageDevices({ environmentId, input: {} }));
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const devices = currentOnly
    ? query.data?.current
      ? [query.data.current]
      : []
    : [...(query.data?.devices ?? []), ...(query.data?.rules ?? [])].filter(
        (device, index, all) =>
          all.findIndex(
            (entry) =>
              JSON.stringify({ ...entry, name: undefined, deviceName: undefined }) ===
              JSON.stringify({ ...device, name: undefined, deviceName: undefined }),
          ) === index,
      );
  return (
    <View className="gap-3">
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
              editable={canWrite}
              key={rule?.name ?? ""}
              defaultValue={rule?.name ?? _name ?? _ruleName ?? ""}
              placeholder="Name this device"
              maxLength={40}
              className="rounded-lg border border-border p-3 text-foreground"
              onEndEditing={(event) => {
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
      {query.error ? <Text>{query.error}</Text> : null}
    </View>
  );
}

export function MobileBuildVisibility({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const settings = useEnvironmentServerConfig(environmentId)?.settings;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  return (
    <SettingsSwitchRow
      label="Show Building T3 settings"
      subtitle="Configure cloud builds, APK builds and loading AppImages on this environment."
      disabled={!canWrite}
      value={settings?.buildToolsSettingsVisible ?? false}
      onValueChange={(buildToolsSettingsVisible) =>
        void update({ environmentId, input: { patch: { buildToolsSettingsVisible } } })
      }
    />
  );
}

export function MobileExtraSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentServerConfig(environmentId)?.settings;
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    serverEnvironment.buildToolsState({ environmentId, input: {} }),
  );
  if (!settings) return null;
  return (
    <SettingsSection title="Extra features">
      {FEATURE_OFFERS.filter(
        (offer) =>
          offer.page === 2 && offer.setting && offer.setting !== "buildToolsSettingsVisible",
      ).map((offer) => {
        const key = offer.setting!;
        if (key === "connectDeviceLongSessions" || key === "claudeHoldBackgroundCommands")
          return null;
        return (
          <SettingsSwitchRow
            key={offer.id}
            label={
              offer.id === "subagents"
                ? "Use T3 delegation (delegate_task)"
                : offer.id === "thread-only-stop"
                  ? "Stop stops only this thread"
                  : offer.title
            }
            subtitle={offer.description}
            value={settings[key] === (offer.enabledValue ?? true)}
            disabled={!canWrite}
            onValueChange={(checked) =>
              void update({
                environmentId,
                input: {
                  patch: {
                    [key]: checked ? (offer.enabledValue ?? true) : !(offer.enabledValue ?? true),
                  },
                },
              })
            }
          />
        );
      })}
      <Text>
        Background Git is currently {query.data?.backgroundGitEnabled ? "on" : "off"}.{" "}
        {query.data?.backgroundGitOverridden
          ? "T3CODE_BACKGROUND_GIT overrides the saved choice."
          : query.data && query.data.backgroundGitEnabled !== settings.backgroundGitEnabled
            ? "Restart to apply your saved choice."
            : "Restart to apply changes."}
      </Text>
      <Text>Work assistance (not recommended)</Text>
      <Text className="text-foreground-muted">
        Untested. Lets a signed-in local t3 client add a helper agent to a thread in this project
        that has worked nonstop for over 5 minutes. HomuCode never starts helpers by itself.
      </Text>
      <MobileWorkAssistancePicker
        environmentId={environmentId}
        value={settings.workAssistanceTarget}
        onChange={(workAssistanceTarget) => {
          if (canWrite) void update({ environmentId, input: { patch: { workAssistanceTarget } } });
        }}
      />
      <Button
        label="Turn off work assistance"
        disabled={!canWrite || !settings.workAssistanceTarget}
        onPress={() =>
          void update({ environmentId, input: { patch: { workAssistanceTarget: null } } })
        }
      />
      <Text>Device names</Text>
      <MobileDeviceNames environmentId={environmentId} />
    </SettingsSection>
  );
}

export function SettingsBuildingT3RouteScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title="Building T3">
      <ScreenScrollView contentContainerClassName="gap-6 p-5">
        {selectedTargets
          .filter((target) => target.serverConfig?.settings.buildToolsSettingsVisible)
          .map((target) => (
            <MobileBuildTools key={target.environmentId} environmentId={target.environmentId} />
          ))}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

export function MobileBuildTools({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentServerConfig(environmentId)?.settings;
  const query = useEnvironmentQuery(
    serverEnvironment.buildToolsState({ environmentId, input: {} }),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const run = useAtomCommand(serverEnvironment.buildToolsRun);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canRun = useAtomValue(serverEnvironment.buildToolsRun.permissionAtom(environmentId));
  const [ref, setRef] = useState("origin/main");
  const [testFile, setTestFile] = useState("");
  const [stagedFile, setStagedFile] = useState("");
  const [sha256, setSha256] = useState("");
  const [confirm, setConfirm] = useState<BuildToolsRequest["action"] | null>(null);
  const action = (action: BuildToolsRequest["action"]) =>
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
  const busy = query.data?.phase === "running";
  if (!settings) return null;
  return (
    <View className="gap-4">
      {(
        [
          ["buildRepoPath", "T3 Code checkout"],
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
        disabled={!canRun || !query.data?.stagedBuilds?.previous}
        onPress={() => action("undo")}
      />
      {query.data?.undoneAs ? (
        <Button label="Redo staged build" disabled={!canRun} onPress={() => action("redo")} />
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
        disabled={!canRun || busy || !settings.cloudBuildEnabled}
        onPress={() => setConfirm("cloud-build")}
      />
      <Button
        label="Run focused tests"
        disabled={!canRun || busy || !settings.cloudBuildEnabled || !testFile.trim()}
        onPress={() => setConfirm("cloud-test")}
      />
      <Button
        label="Build Android APK"
        disabled={!canRun || busy || !settings.androidBuildEnabled}
        onPress={() => setConfirm("android")}
      />
      <SettingsSwitchRow
        label="Serve APKs on LAN"
        subtitle="Serve ~/app/mobile on port 8767 until switched off or the server stops."
        value={Boolean(query.data?.lanUrl)}
        disabled={!canRun || (!settings.androidBuildEnabled && !query.data?.lanUrl)}
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
          !canRun ||
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
              ? "This restarts T3, with automatic rollback if it fails to return."
              : "This starts a cloud machine on your boat.dev account."}
          </Text>
          <Button
            label="Confirm"
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
