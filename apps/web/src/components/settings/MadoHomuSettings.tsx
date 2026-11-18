import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { type EnvironmentId, type ServerSettings } from "@t3tools/contracts";
import { MADOHOMU_SCRATCH_LABEL } from "@t3tools/client-runtime/madohomu";
import { madohomuDestinationEnvironmentIdAtom } from "../../madohomu";
import { isElectron } from "../../env";
import { useMadoHomuActions } from "../madohomu/useMadoHomuActions";
import { MadoHomuProjectPicker } from "../madohomu/MadoHomuProjectPicker";
import { useEnvironments } from "../../state/environments";
import { isConnectedWithConfig } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const CODE_VISIBILITY_LABELS = {
  hidden: "None",
  scratch: `${MADOHOMU_SCRATCH_LABEL} only`,
  all: "All",
} as const satisfies Record<ServerSettings["madohomuCodeVisibility"], string>;

const WORKING_PLACEMENT_LABELS = {
  section: "Working section",
  top: `Top of ${MADOHOMU_SCRATCH_LABEL}`,
  none: "Leave in place",
} as const satisfies Record<ServerSettings["madohomuWorkingPlacement"], string>;

export function MadoHomuSettings() {
  const { target, scope } = useSettingsScope();
  const { environments } = useEnvironments();
  const targets = environments.filter(isConnectedWithConfig);
  const destination = useAtomValue(madohomuDestinationEnvironmentIdAtom);
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  if (scope.kind === "project" || scope.kind === "checkout") return null;
  const preferredId =
    selectedId ?? (scope.kind === "environment" ? scope.environmentId : destination);
  const selected =
    targets.find((candidate) => candidate.environmentId === preferredId) ??
    targets.find((candidate) => candidate.environmentId === target?.environmentId) ??
    targets[0];
  if (!selected)
    return (
      <SettingsSection id="madohomu" title="MadoHomu">
        <p className="p-4 text-sm text-muted-foreground">
          Connect an environment to configure MadoHomu.
        </p>
      </SettingsSection>
    );
  const environmentPicker =
    targets.length > 1 ? (
      <SettingsRow
        title="Environment"
        control={
          <Select value={selected.environmentId} onValueChange={setSelectedId}>
            <SelectTrigger aria-label="MadoHomu environment" size="sm">
              <SelectValue>{selected.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {targets.map(({ environmentId, label }) => (
                <SelectItem key={environmentId} value={environmentId}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    ) : null;
  return (
    <EnvironmentMadoHomuSettings
      key={selected.environmentId}
      environmentId={selected.environmentId}
      environmentPicker={environmentPicker}
      onProjectChosen={setSelectedId}
    />
  );
}

function EnvironmentMadoHomuSettings({
  environmentId,
  environmentPicker,
  onProjectChosen,
}: {
  environmentId: EnvironmentId;
  environmentPicker: ReactNode;
  onProjectChosen: (environmentId: EnvironmentId) => void;
}) {
  const actions = useMadoHomuActions(environmentId);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const savedTime =
    actions.task?.schedule.type === "fixed_time" ? actions.task.schedule.timeOfDay : "09:00";
  const briefEnabled =
    actions.task?.enabled === true && actions.task.projectId === actions.settings.madohomuProjectId;
  const run = async (action: () => Promise<boolean>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    await (async () => {
      await action();
    })().finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  return (
    <SettingsSection id="madohomu" title="MadoHomu">
      {environmentPicker}
      <SettingsRow
        {...searchableSetting("madohomu-enabled")}
        description="A focused view for one project, with your threads in sections. Every MadoHomu thread starts pinned."
        control={
          <Switch
            aria-label="Enable MadoHomu"
            checked={actions.settings.madohomuEnabled}
            disabled={!actions.canWrite || busy}
            onCheckedChange={(enabled) =>
              void run(() => actions.save({ madohomuEnabled: enabled }))
            }
          />
        }
      />
      {actions.settings.madohomuEnabled ? (
        <>
          <SettingsRow {...searchableSetting("madohomu-project")}>
            <MadoHomuProjectPicker environmentId={environmentId} onChosen={onProjectChosen} />
            <div className="py-2 text-sm">
              <Link
                to="/madohomu"
                search={{ environmentId }}
                className="underline underline-offset-2"
              >
                Open MadoHomu
              </Link>
            </div>
          </SettingsRow>
          <SettingsRow
            {...searchableSetting("madohomu-code-visibility")}
            description={`Which threads of the MadoHomu project T3 Code's thread list shows. ${MADOHOMU_SCRATCH_LABEL} threads are the ones not pinned in MadoHomu.`}
            control={
              <Select
                value={actions.settings.madohomuCodeVisibility}
                disabled={!actions.canWrite || busy}
                onValueChange={(value) => {
                  if (value === null) return;
                  void run(() => actions.save({ madohomuCodeVisibility: value }));
                }}
              >
                <SelectTrigger
                  aria-label="Show MadoHomu threads in T3 Code"
                  className="w-36"
                  size="sm"
                >
                  <SelectValue>
                    {CODE_VISIBILITY_LABELS[actions.settings.madohomuCodeVisibility]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {(
                    Object.keys(CODE_VISIBILITY_LABELS) as Array<
                      keyof typeof CODE_VISIBILITY_LABELS
                    >
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {CODE_VISIBILITY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("madohomu-working-placement")}
            description={`Where a ${MADOHOMU_SCRATCH_LABEL} thread shows in MadoHomu while it is working. Pinned threads keep their place.`}
            control={
              <Select
                value={actions.settings.madohomuWorkingPlacement}
                disabled={!actions.canWrite || busy}
                onValueChange={(value) => {
                  if (value === null) return;
                  void run(() => actions.save({ madohomuWorkingPlacement: value }));
                }}
              >
                <SelectTrigger aria-label="Working threads" className="w-36" size="sm">
                  <SelectValue>
                    {WORKING_PLACEMENT_LABELS[actions.settings.madohomuWorkingPlacement]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {(
                    Object.keys(WORKING_PLACEMENT_LABELS) as Array<
                      keyof typeof WORKING_PLACEMENT_LABELS
                    >
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {WORKING_PLACEMENT_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("madohomu-morning-brief")}
            description="A daily summary of work in progress, decisions waiting on you, and proposed next steps. The agent plans and asks for approval before acting."
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
              <label className="text-sm" htmlFor="madohomu-brief-time">
                Daily time
              </label>
              <Input
                id="madohomu-brief-time"
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
              {...searchableSetting("madohomu-desktop-app")}
              description="Add MadoHomu to this desktop's app launcher. Opens a separate window."
              control={
                <Switch
                  aria-label="MadoHomu desktop app"
                  checked={actions.settings.madohomuDesktopAppEnabled}
                  disabled={busy || !actions.canWrite}
                  onCheckedChange={(enabled) =>
                    void run(() => actions.save({ madohomuDesktopAppEnabled: enabled }))
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
