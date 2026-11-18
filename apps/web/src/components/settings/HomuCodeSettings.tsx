import { DEFAULT_UNIFIED_SETTINGS, SidebarThreadFolderStyle } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { AgentMemorySettings } from "./AgentMemorySettings";
import { AppScriptsSettingsSection } from "./AppScriptsSettings";
import { BehaviorSettingsSection } from "./BehaviorSettings";
import { BuildToolsSetup } from "./BuildToolsSettings";
import { MadoHomuSettings } from "./MadoHomuSettings";
import { LocalThreadsUseDefaultBranchRow, QuickModelRow } from "./ProjectDefaultsSettings";
import { ScopedSwitch } from "./ScopedSwitch";
import { ScratchEnvironmentSettings } from "./ScratchEnvironmentSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { StagedBuildSettingsRow } from "./StagedBuildSettingsRow";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingResetButton,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const SIDEBAR_THREAD_FOLDER_STYLE_LABELS: Record<SidebarThreadFolderStyle, string> = {
  cards: "Cards",
  tabs: "Tab groups",
};
const isSidebarThreadFolderStyle = Schema.is(SidebarThreadFolderStyle);

export function HomuCodeSettingsPanel() {
  const { scope, connectedEnvironments } = useSettingsScope();
  const unavailableReason =
    scope.kind === "unavailable"
      ? scope.message
      : scope.kind === "environment" && connectedEnvironments.length === 0
        ? `Reconnect ${scope.label} to change its settings.`
        : null;

  return (
    <SettingsPageContainer searchTargetFallbacks={{ homucode: "settings-sync" }}>
      <HomuCodeDeviceSettings />
      <MadoHomuSettings />
      {unavailableReason === null ? (
        <HomuCodeEnvironmentSettings />
      ) : (
        <p className="text-sm text-muted-foreground">{unavailableReason}</p>
      )}
    </SettingsPageContainer>
  );
}

function HomuCodeDeviceSettings() {
  const settings = useClientSettings();
  const { environments } = useEnvironments();
  const scratchEnvironments = environments.filter(
    (environment) => environment.entry.enabled && environment.connection.phase !== "unsupported",
  );

  return (
    <>
      <SettingsSection title="Settings sync">
        <SettingsRow
          {...searchableSetting("settings-sync")}
          description="Keep this device's settings the same as your other devices', through connected servers. When a setting changed in two places, or on first setup, you choose which value to keep."
          control={
            <Switch
              checked={settings.settingsSyncEnabled}
              onCheckedChange={(checked) =>
                void updateClientSettings({ settingsSyncEnabled: Boolean(checked) })
              }
              aria-label="Settings sync"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Sent messages">
        <SettingsRow
          {...searchableSetting("user-message-markdown")}
          description="Off shows your sent messages as the plain text you typed."
          resetAction={
            settings.userMessageMarkdownEnabled !==
            DEFAULT_UNIFIED_SETTINGS.userMessageMarkdownEnabled ? (
              <SettingResetButton
                label="sent message formatting"
                onClick={() =>
                  void updateClientSettings({
                    userMessageMarkdownEnabled: DEFAULT_UNIFIED_SETTINGS.userMessageMarkdownEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.userMessageMarkdownEnabled}
              onCheckedChange={(checked) =>
                void updateClientSettings({ userMessageMarkdownEnabled: Boolean(checked) })
              }
              aria-label="Format sent messages as Markdown"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("user-message-plus-bullets")}
          description="Off keeps a + at the start of a line in your sent messages as you typed it."
          resetAction={
            settings.userMessagePlusBullets !== DEFAULT_UNIFIED_SETTINGS.userMessagePlusBullets ? (
              <SettingResetButton
                label="+ bullets"
                onClick={() =>
                  void updateClientSettings({
                    userMessagePlusBullets: DEFAULT_UNIFIED_SETTINGS.userMessagePlusBullets,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.userMessagePlusBullets}
              disabled={!settings.userMessageMarkdownEnabled}
              onCheckedChange={(checked) =>
                void updateClientSettings({ userMessagePlusBullets: Boolean(checked) })
              }
              aria-label="Lines starting with + become bullets"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Sidebar">
        <SettingsRow
          {...searchableSetting("thread-folder-style")}
          description="Cards tint each folder. Tab groups color the folder name and draw a line beside its threads."
          resetAction={
            settings.sidebarThreadFolderStyle !==
            DEFAULT_UNIFIED_SETTINGS.sidebarThreadFolderStyle ? (
              <SettingResetButton
                label="folder style"
                onClick={() =>
                  void updateClientSettings({
                    sidebarThreadFolderStyle: DEFAULT_UNIFIED_SETTINGS.sidebarThreadFolderStyle,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarThreadFolderStyle}
              onValueChange={(value) => {
                if (isSidebarThreadFolderStyle(value)) {
                  void updateClientSettings({ sidebarThreadFolderStyle: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Folder style">
                <SelectValue>
                  {SIDEBAR_THREAD_FOLDER_STYLE_LABELS[settings.sidebarThreadFolderStyle]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarThreadFolderStyle.literals.map((style) => (
                  <SelectItem hideIndicator key={style} value={style}>
                    {SIDEBAR_THREAD_FOLDER_STYLE_LABELS[style]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
      <ScratchEnvironmentSettings environments={scratchEnvironments} />
      <AppScriptsSettingsSection />
    </>
  );
}

function HomuCodeEnvironmentSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedStatusLineCommand = useScopedSettingsMixed(["statusLineCommand"]);
  const mixedProjectName = useScopedSettingsMixed(["threadTitleIncludeProjectName"]);
  const mixedIdPrefix = useScopedSettingsMixed(["threadTitleIdPrefix"]);
  const { scope, connectedEnvironments } = useSettingsScope();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentScope = scope.kind === "all" || scope.kind === "environment";
  const buildEnvironment =
    connectedEnvironments.length === 1 ? connectedEnvironments[0] : undefined;
  const primaryEnvironment = environments.find(
    (entry) => entry.environmentId === primaryEnvironmentId,
  );
  const showStagedBuild =
    environmentScope &&
    (scope.kind === "all" || buildEnvironment?.environmentId === primaryEnvironmentId) &&
    typeof window !== "undefined" &&
    Boolean(window.desktopBridge) &&
    !primaryEnvironment?.serverConfig?.settings.buildToolsSettingsVisible;

  return (
    <>
      <BehaviorSettingsSection />
      <SettingsSection id="subagents" title="Subagents">
        <SettingsRow
          serverScoped
          {...searchableSetting("prefer-native-subagents")}
          settingKeys={["preferNativeSubagents"]}
          description="Use provider-native subagents for same-provider work. Off routes every subagent through T3 Code. Applies next turn; providers that load instructions at startup need a thread restart."
          control={
            <ScopedSwitch
              settingKeys={["preferNativeSubagents"]}
              checked={settings.preferNativeSubagents}
              onCheckedChange={(checked) =>
                updateSettings({ preferNativeSubagents: Boolean(checked) })
              }
              aria-label="Prefer native subagents"
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("subagents-inherit-parent-pin")}
          settingKeys={["subagentsInheritParentPin"]}
          description="Pin new subagents on the devices where their parent is pinned. Applies to subagents on the same server."
          control={
            <ScopedSwitch
              settingKeys={["subagentsInheritParentPin"]}
              checked={settings.subagentsInheritParentPin}
              onCheckedChange={(checked) =>
                updateSettings({ subagentsInheritParentPin: Boolean(checked) })
              }
              aria-label="Subagents inherit parent pin"
            />
          }
        />
      </SettingsSection>
      <SettingsSection id="claude-background-commands" title="Claude background commands">
        <SettingsRow
          serverScoped
          {...searchableSetting("claude-hold-background-commands")}
          settingKeys={["claudeHoldBackgroundCommands"]}
          description="Keep Claude threads in Working until new background commands finish or the agent releases them. Applies without restarting. Claude monitors always keep threads working."
          control={
            <ScopedSwitch
              settingKeys={["claudeHoldBackgroundCommands"]}
              checked={settings.claudeHoldBackgroundCommands}
              onCheckedChange={(checked) =>
                updateSettings({ claudeHoldBackgroundCommands: Boolean(checked) })
              }
              aria-label="Keep Claude threads working while background commands run"
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="autoreview" title="Autoreviewers">
        <SettingsRow
          serverScoped
          {...searchableSetting("autoreviewers")}
          description="Not recommended: reviewers lag behind the thread, so findings are often stale. Lets agents attach reviewer subagents to a thread. Turning this off pauses attached reviewers."
          settingKeys={["autoreviewEnabled"]}
          control={
            <ScopedSwitch
              settingKeys={["autoreviewEnabled"]}
              checked={settings.autoreviewEnabled}
              onCheckedChange={(checked) => updateSettings({ autoreviewEnabled: Boolean(checked) })}
              aria-label="Autoreviewers (not recommended)"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="New threads">
        <QuickModelRow />
        <LocalThreadsUseDefaultBranchRow />
      </SettingsSection>
      <SettingsSection title="Thread titles">
        <SettingsRow
          serverScoped
          settingKeys={["threadTitleIncludeProjectName"]}
          mixed={mixedProjectName}
          {...searchableSetting("thread-title-project-name")}
          description="Show the titler the project name, so titles can leave out what it already says."
          resetAction={
            mixedProjectName || !settings.threadTitleIncludeProjectName ? (
              <SettingResetButton
                label="project name for titles"
                onClick={() => updateSettings({ threadTitleIncludeProjectName: true })}
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Show the project name to the titler"
              mixed={mixedProjectName}
              checked={mixedProjectName ? false : settings.threadTitleIncludeProjectName}
              onCheckedChange={(enabled) =>
                updateSettings({ threadTitleIncludeProjectName: enabled })
              }
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["threadTitleIdPrefix"]}
          mixed={mixedIdPrefix}
          {...searchableSetting("thread-title-id-prefix")}
          description="Show a short ID before each generated title: its first letter, plus a number when another active thread has it (F, F1, F2). Settled threads add a letter (F1a)."
          resetAction={
            mixedIdPrefix || settings.threadTitleIdPrefix ? (
              <SettingResetButton
                label="title IDs"
                onClick={() => updateSettings({ threadTitleIdPrefix: false })}
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Prefix thread titles with an ID"
              mixed={mixedIdPrefix}
              checked={mixedIdPrefix ? false : settings.threadTitleIdPrefix}
              onCheckedChange={(enabled) => updateSettings({ threadTitleIdPrefix: enabled })}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Status line">
        <SettingsRow
          serverScoped
          settingKeys={["statusLineEnabled"]}
          {...searchableSetting("status-line")}
          description="Show the model, context, and usage limits in the top bar."
          resetAction={
            settings.statusLineEnabled !== DEFAULT_UNIFIED_SETTINGS.statusLineEnabled ? (
              <SettingResetButton
                label="status line"
                onClick={() =>
                  updateSettings({ statusLineEnabled: DEFAULT_UNIFIED_SETTINGS.statusLineEnabled })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["statusLineEnabled"]}
              checked={settings.statusLineEnabled}
              onCheckedChange={(checked) => updateSettings({ statusLineEnabled: Boolean(checked) })}
              aria-label="Show the status line"
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["statusLineCommand"]}
          {...searchableSetting("status-line-command")}
          description="A command that reads Claude Code's status line JSON on stdin and prints a line of text, shown in place of the dials. Leave empty for the built-in status line."
          resetAction={
            settings.statusLineCommand !== DEFAULT_UNIFIED_SETTINGS.statusLineCommand ? (
              <SettingResetButton
                label="status line command"
                onClick={() =>
                  updateSettings({ statusLineCommand: DEFAULT_UNIFIED_SETTINGS.statusLineCommand })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedStatusLineCommand ? "" : settings.statusLineCommand}
              onCommit={(next) => updateSettings({ statusLineCommand: next.trim() })}
              placeholder={mixedStatusLineCommand ? "Mixed" : "Built-in"}
              spellCheck={false}
              aria-label="Status line command"
            />
          }
        />
      </SettingsSection>
      <AgentMemorySettings />
      <SettingsSection id="building-t3" title="Building T3">
        <SettingsRow
          {...searchableSetting("show-building-t3")}
          description="Configure cloud builds, Android APK builds, and loading AppImages."
          serverScoped
          settingKeys={["buildToolsSettingsVisible"]}
          control={
            <Switch
              checked={settings.buildToolsSettingsVisible}
              aria-label="Show Building T3 settings"
              onCheckedChange={(value) =>
                updateSettings({ buildToolsSettingsVisible: Boolean(value) })
              }
            />
          }
        />
        {showStagedBuild ? (
          <StagedBuildSettingsRow
            {...(primaryEnvironmentId ? { environmentId: primaryEnvironmentId } : {})}
          />
        ) : null}
      </SettingsSection>
      {environmentScope && buildEnvironment?.serverConfig?.settings.buildToolsSettingsVisible ? (
        <BuildToolsSetup
          key={buildEnvironment.environmentId}
          environmentId={buildEnvironment.environmentId}
        />
      ) : environmentScope &&
        connectedEnvironments.some(
          (environment) => environment.serverConfig?.settings.buildToolsSettingsVisible,
        ) ? (
        <p className="text-sm text-muted-foreground">
          Select one environment to configure Building T3.
        </p>
      ) : null}
    </>
  );
}
