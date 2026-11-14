import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useRef } from "react";

import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ThreadTitleInstructionsSettings() {
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["threadTitleInstructions"]);
  const mixedProjectName = useScopedSettingsMixed(["threadTitleIncludeProjectName"]);
  const mixedIdPrefix = useScopedSettingsMixed(["threadTitleIdPrefix"]);
  const defaultInstructions = DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions;

  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["threadTitleInstructions"]}
        {...searchableSetting("thread-title-instructions")}
        description="Appended to the prompt for new and regenerated thread titles."
        resetAction={
          mixed || settings.threadTitleInstructions !== defaultInstructions ? (
            <SettingResetButton
              label="thread title instructions"
              onClick={() => updateSettings({ threadTitleInstructions: defaultInstructions })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${mixed}:${settings.threadTitleInstructions}`}
            aria-label="Thread title instructions"
            onChange={() => {
              edited.current = true;
            }}
            rows={4}
            defaultValue={mixed ? "" : settings.threadTitleInstructions}
            placeholder={
              mixed
                ? "Mixed. Enter instructions to apply to all selected targets."
                : "Keep titles to a few words. Lead with the main subject."
            }
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (edited.current && (mixed || value !== settings.threadTitleInstructions))
                updateSettings({ threadTitleInstructions: value });
              edited.current = false;
            }}
          />
        </div>
      </SettingsRow>
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
    </>
  );
}
