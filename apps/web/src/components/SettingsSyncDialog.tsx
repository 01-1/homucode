import {
  type ClientSettingsSyncChoice,
  formatSyncedSettingValue,
  syncedSettingLabel,
} from "@t3tools/client-runtime/state/client-settings-sync";
import { useState } from "react";

import {
  deferSettingsSyncPrompt,
  resolveSettingsSyncPrompt,
  type SettingsSyncPrompt,
  useSettingsSyncPrompt,
} from "../settingsSync";
import { updateClientSettings } from "../hooks/useSettings";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

export function SettingsSyncDialogHost() {
  const prompt = useSettingsSyncPrompt();
  // Keyed so a new prompt starts from fresh choices.
  return prompt ? (
    <SettingsSyncDialog key={prompt.conflicts.map(({ key }) => key).join()} prompt={prompt} />
  ) : null;
}

function SettingsSyncDialog({ prompt }: { prompt: SettingsSyncPrompt }) {
  const [choices, setChoices] = useState<Record<string, ClientSettingsSyncChoice>>(() =>
    Object.fromEntries(prompt.conflicts.map(({ key }) => [key, "remote" as const])),
  );
  const chooseAll = (choice: ClientSettingsSyncChoice) =>
    setChoices(Object.fromEntries(prompt.conflicts.map(({ key }) => [key, choice])));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) deferSettingsSyncPrompt();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {prompt.firstSetup ? "Set up settings sync" : "Settings changed in two places"}
          </DialogTitle>
          <DialogDescription>
            {prompt.firstSetup
              ? "This device's settings differ from the ones synced through your server. Choose which value to keep for each."
              : "These settings changed on this device and on another one since they last synced. Choose which value to keep for each."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => chooseAll("remote")}>
                Use synced for all
              </Button>
              <Button size="sm" variant="outline" onClick={() => chooseAll("local")}>
                Keep this device for all
              </Button>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {prompt.conflicts.map((conflict) => (
                <li key={conflict.key} className="flex flex-col gap-2 py-2">
                  <span className="text-sm font-medium">{syncedSettingLabel(conflict.key)}</span>
                  <ToggleGroup
                    aria-label={syncedSettingLabel(conflict.key)}
                    className="w-full *:min-w-0 *:flex-1"
                    value={[choices[conflict.key] ?? "remote"]}
                    onValueChange={(next) => {
                      const value = next[0];
                      if (value === "local" || value === "remote") {
                        setChoices((current) => ({ ...current, [conflict.key]: value }));
                      }
                    }}
                  >
                    <Toggle value="local">
                      <span className="truncate">
                        This device: {formatSyncedSettingValue(conflict.local)}
                      </span>
                    </Toggle>
                    <Toggle value="remote">
                      <span className="truncate">
                        Synced: {formatSyncedSettingValue(conflict.remote)}
                      </span>
                    </Toggle>
                  </ToggleGroup>
                </li>
              ))}
            </ul>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              void updateClientSettings({ settingsSyncEnabled: false });
              deferSettingsSyncPrompt();
            }}
          >
            Turn off sync on this device
          </Button>
          <Button variant="outline" onClick={deferSettingsSyncPrompt}>
            Decide later
          </Button>
          <Button onClick={() => resolveSettingsSyncPrompt(choices)}>Apply</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
