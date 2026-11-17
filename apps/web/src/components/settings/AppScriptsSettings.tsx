import { isElectron } from "~/env";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Each switch is this device's own; none of them sync or can be set by an agent's tools. */
export function AppScriptsSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const terminalAvailable = isElectron && settings.appScriptsEnabled;
  return (
    <SettingsSection id="app-scripts" title="App scripts">
      <div className="px-4 pt-4 sm:px-5">
        <Alert variant="warning">
          <AlertTitle>Scripts can do anything you can do in this window</AlertTitle>
          <AlertDescription>
            They can start and message agents, read your threads, and press any shortcut. Only
            turn this on if you trust every file in the scripts folder, including ones an agent
            could write there.
          </AlertDescription>
        </Alert>
      </div>
      <SettingsRow
        {...searchableSetting("app-scripts")}
        description={
          <>
            Run TypeScript files from the <code>scripts</code> folder in T3 Code&apos;s data folder
            (<code>~/.t3/userdata/scripts</code> by default) with a keybinding such as{" "}
            <code>user.my-script.run</code>. Works in the desktop app and in a browser on this
            machine. Off by default, on this device only.
          </>
        }
        control={
          <Switch
            checked={settings.appScriptsEnabled}
            onCheckedChange={(checked) =>
              updateSettings({
                appScriptsEnabled: Boolean(checked),
                // Turning the feature off also closes the narrower doors, so turning it on again
                // never reopens them silently.
                ...(checked ? {} : { appScriptsFromTerminal: false, appScriptsFromAgents: false }),
              })
            }
            aria-label="App scripts"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("app-scripts-terminal")}
        description={
          isElectron
            ? "Also let `t3 app run <name|file.ts>` run scripts in this window from a terminal on this machine."
            : "`t3 app run` needs the desktop app."
        }
        control={
          <Switch
            checked={terminalAvailable && settings.appScriptsFromTerminal}
            disabled={!terminalAvailable}
            onCheckedChange={(checked) =>
              updateSettings({
                appScriptsFromTerminal: Boolean(checked),
                ...(checked ? {} : { appScriptsFromAgents: false }),
              })
            }
            aria-label="Run app scripts from the terminal"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("app-scripts-agents")}
        description="Also accept `t3 app run` from an agent's shell. Off, T3 Code refuses it when the command carries an agent's thread. An agent that hides that, or edits settings files directly, can still get past this, so treat it as a guard against mistakes, not a sandbox."
        control={
          <Switch
            checked={
              terminalAvailable && settings.appScriptsFromTerminal && settings.appScriptsFromAgents
            }
            disabled={!terminalAvailable || !settings.appScriptsFromTerminal}
            onCheckedChange={(checked) => updateSettings({ appScriptsFromAgents: Boolean(checked) })}
            aria-label="Let agents run app scripts"
          />
        }
      />
    </SettingsSection>
  );
}
