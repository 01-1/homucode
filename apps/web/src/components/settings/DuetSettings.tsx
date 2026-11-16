import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { type EnvironmentId } from "@t3tools/contracts";
import { isElectron } from "../../env";
import { useDuetActions } from "../duet/useDuetActions";
import { DuetProjectPicker } from "../duet/DuetPage";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

export function DuetSettings() {
  const { target, targets, scope } = useSettingsScope();
  if (scope.kind === "project" || scope.kind === "checkout") return null;
  if (targets.length > 1)
    return (
      <SettingsSection id="duet" title="Duet">
        <p className="p-4 text-sm text-muted-foreground">
          Choose an environment above to configure Duet.
        </p>
      </SettingsSection>
    );
  return target ? <EnvironmentDuetSettings environmentId={target.environmentId} /> : null;
}

function EnvironmentDuetSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useDuetActions(environmentId);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const savedTime =
    actions.task?.schedule.type === "fixed_time" ? actions.task.schedule.timeOfDay : "09:00";
  const briefEnabled =
    actions.task?.enabled === true && actions.task.projectId === actions.settings.duetProjectId;
  const run = async (action: () => Promise<boolean>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <SettingsSection id="duet" title="Duet">
      <SettingsRow
        {...searchableSetting("duet-enabled")}
        description="A focused Chat and Tasks view for one project. Every Duet thread starts pinned."
        control={
          <Switch
            aria-label="Enable Duet"
            checked={actions.settings.duetEnabled}
            disabled={!actions.canWrite || busy}
            onCheckedChange={(enabled) => void run(() => actions.save({ duetEnabled: enabled }))}
          />
        }
      />
      {actions.settings.duetEnabled ? (
        <>
          <SettingsRow {...searchableSetting("duet-project")}>
            <DuetProjectPicker environmentId={environmentId} />
            <div className="py-2 text-sm">
              <Link to="/duet" search={{ environmentId }}>
                Open Duet
              </Link>
            </div>
          </SettingsRow>
          <SettingsRow
            {...searchableSetting("duet-morning-brief")}
            description="A daily summary of work in progress, decisions for Homura, and proposed next steps. The agent plans and asks for approval before acting."
            control={
              <Switch
                aria-label="Morning brief"
                checked={briefEnabled}
                disabled={
                  busy ||
                  !actions.canWrite ||
                  !actions.canSchedule ||
                  !actions.project ||
                  !actions.modelSelection ||
                  !actions.taskQuery.isSuccess
                }
                onCheckedChange={(enabled) =>
                  void run(() => actions.setMorningBrief(enabled, time ?? savedTime))
                }
              />
            }
          >
            <div className="flex items-center gap-3 py-2">
              <label className="text-sm" htmlFor="duet-brief-time">
                Daily time
              </label>
              <Input
                id="duet-brief-time"
                type="time"
                value={time ?? savedTime}
                disabled={busy || !actions.canSchedule}
                onChange={(event) => setTime(event.target.value)}
                onBlur={() => {
                  if (briefEnabled && time && time !== savedTime)
                    void run(() => actions.setMorningBrief(true, time));
                }}
              />
              <span className="text-xs text-muted-foreground">
                {actions.taskQuery.data?.timeZone ?? "Server time"}
              </span>
            </div>
            {actions.taskQuery.error ? (
              <p className="text-sm text-error">{actions.taskQuery.error}</p>
            ) : null}
          </SettingsRow>
          {isElectron ? (
            <SettingsRow
              {...searchableSetting("duet-desktop-app")}
              description="Add T3 Duet to this desktop's app launcher. Opens a separate, phone-sized window."
              control={
                <Switch
                  aria-label="Duet desktop app"
                  checked={actions.settings.duetDesktopAppEnabled}
                  disabled={busy || !actions.canWrite}
                  onCheckedChange={(enabled) =>
                    void run(() => actions.save({ duetDesktopAppEnabled: enabled }))
                  }
                />
              }
            />
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  );
}
