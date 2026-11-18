import {
  type ClientSettingsSyncChoice,
  formatSyncedSettingValue,
  syncedSettingValuePreview,
  syncedSettingLabel,
} from "@t3tools/client-runtime/state/client-settings-sync";
import { useId, useState } from "react";

import {
  deferSettingsSyncPrompt,
  resolveSettingsSyncPrompt,
  type SettingsSyncPrompt,
  useSettingsSyncPrompt,
} from "../settingsSync";
import { updateClientSettings } from "../hooks/useSettings";
import { useEnvironment } from "../state/environments";
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
    <SettingsSyncDialog
      key={[prompt.environmentId, ...prompt.conflicts.map(({ key }) => key)].join()}
      prompt={prompt}
    />
  ) : null;
}

function SettingsSyncDialog({ prompt }: { prompt: SettingsSyncPrompt }) {
  const descriptionId = useId();
  const server = useEnvironment(prompt.environmentId)?.label ?? "your server";
  const [choices, setChoices] = useState<Record<string, ClientSettingsSyncChoice>>(() =>
    Object.fromEntries(prompt.conflicts.map(({ key }) => [key, "remote" as const])),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const chooseAll = (choice: ClientSettingsSyncChoice) =>
    setChoices(Object.fromEntries(prompt.conflicts.map(({ key }) => [key, choice])));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) deferSettingsSyncPrompt();
      }}
    >
      <DialogPopup data-unprompted className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {prompt.firstSetup ? "Set up settings sync" : "Settings changed in two places"}
          </DialogTitle>
          <DialogDescription>
            {prompt.firstSetup
              ? `This device's settings differ from the ones synced through ${server}. Choose which value to keep for each.`
              : `These settings changed on this device and through ${server} since they last synced. Choose which value to keep for each.`}
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
              {prompt.conflicts.map((conflict) => {
                const localId = `${descriptionId}-${conflict.key}-local`;
                const remoteId = `${descriptionId}-${conflict.key}-remote`;
                const local = formatSyncedSettingValue(conflict.key, conflict.local);
                const remote = formatSyncedSettingValue(conflict.key, conflict.remote);
                const localPreview = syncedSettingValuePreview(local);
                const remotePreview = syncedSettingValuePreview(remote);
                const isLong = localPreview !== null || remotePreview !== null;
                const isExpanded = expanded.has(conflict.key);
                return (
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
                      <Toggle value="local" aria-describedby={localId}>
                        This device
                      </Toggle>
                      <Toggle value="remote" aria-describedby={remoteId}>
                        Synced
                      </Toggle>
                    </ToggleGroup>
                    <div className="grid grid-cols-2 gap-2 text-muted-foreground text-xs">
                      <pre id={localId} className="whitespace-pre-wrap break-all font-mono">
                        {isExpanded ? local : (localPreview ?? local)}
                      </pre>
                      <pre id={remoteId} className="whitespace-pre-wrap break-all font-mono">
                        {isExpanded ? remote : (remotePreview ?? remote)}
                      </pre>
                    </div>
                    {isLong ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="self-start"
                        aria-expanded={isExpanded}
                        onClick={() => toggleExpanded(conflict.key)}
                      >
                        {isExpanded ? "Show less" : "Read more"}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
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
