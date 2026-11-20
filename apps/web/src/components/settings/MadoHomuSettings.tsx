import { useGT, T } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { EnvironmentId, type ServerSettings } from "@t3tools/contracts";
import { MADOHOMU_SCRATCH_LABEL } from "@t3tools/client-runtime/madohomu";
import {
  canUpdateMadoHomuDesktopLauncherAtom,
  madohomuDestinationEnvironmentIdAtom,
  madohomuDesktopLauncherEnabledAtom,
  saveMadoHomuDesktopLauncherEnabled,
} from "../../madohomu";
import { isElectron } from "../../env";
import { useMadoHomuActions } from "../madohomu/useMadoHomuActions";
import { MadoHomuProjectPicker } from "../madohomu/MadoHomuProjectPicker";
import { useEnvironments } from "../../state/environments";
import { isConnectedWithConfig } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SettingsRow,
  SettingsSearchTarget,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";

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
  const gt = useGT();
  const { target, scope, search, selectScope } = useSettingsScope();
  const { environments } = useEnvironments();
  const destination = useAtomValue(madohomuDestinationEnvironmentIdAtom);
  const searchTargetId = useSettingsSearchTargetId();
  if (scope.kind === "project" || scope.kind === "checkout") return null;
  const machineId =
    (search.machine ? EnvironmentId.make(search.machine) : destination) ??
    target?.environmentId ??
    environments[0]?.environmentId;
  const selected = environments.find((candidate) => candidate.environmentId === machineId);
  const label = selected?.label ?? machineId;
  const selectMachine = (environmentId: EnvironmentId | null) => {
    if (environmentId !== null && environmentId !== search.machine) {
      selectScope({ ...search, machine: environmentId });
    }
  };
  const environmentPicker =
    environments.length > 1 || (machineId && !selected && environments.length > 0) ? (
      <SettingsRow
        title={gt("Environment")}
        control={
          <Select value={machineId ?? null} onValueChange={selectMachine}>
            <SelectTrigger aria-label={gt("MadoHomu environment")} size="sm">
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {environments.map(({ environmentId, label }) => (
                <SelectItem key={environmentId} value={environmentId}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    ) : null;
  if (!selected || !isConnectedWithConfig(selected)) {
    return (
      <SettingsSection id="madohomu" title="MadoHomu">
        {environmentPicker}
        <SettingsSearchTarget
          id={searchTargetId?.startsWith("madohomu-") ? searchTargetId : undefined}
        >
          <p className="p-4 text-sm text-muted-foreground">
            {label
              ? gt("Reconnect {label} to configure MadoHomu.", { label })
              : gt("Connect an environment to configure MadoHomu.")}
          </p>
        </SettingsSearchTarget>
      </SettingsSection>
    );
  }
  return (
    <EnvironmentMadoHomuSettings
      key={selected.environmentId}
      environmentId={selected.environmentId}
      environmentPicker={environmentPicker}
      onProjectChosen={selectMachine}
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
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
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
        description={gt(
          "A focused view for one project, with your threads in sections. Every MadoHomu thread starts pinned.",
        )}
        control={
          <Switch
            aria-label={gt("Enable MadoHomu")}
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
                <T>Open MadoHomu</T>
              </Link>
            </div>
          </SettingsRow>
          <SettingsRow
            {...searchableSetting("madohomu-code-visibility")}
            description={gt(
              "Which threads of the MadoHomu project HomuCode's thread list shows. {scratch} threads are the ones not pinned in MadoHomu.",
              { scratch: MADOHOMU_SCRATCH_LABEL },
            )}
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
                  aria-label={gt("Show MadoHomu threads in HomuCode")}
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
            description={gt(
              "Where a {scratch} thread shows in MadoHomu while it is working. Pinned threads keep their place.",
              { scratch: MADOHOMU_SCRATCH_LABEL },
            )}
            control={
              <Select
                value={actions.settings.madohomuWorkingPlacement}
                disabled={!actions.canWrite || busy}
                onValueChange={(value) => {
                  if (value === null) return;
                  void run(() => actions.save({ madohomuWorkingPlacement: value }));
                }}
              >
                <SelectTrigger aria-label={gt("Working threads")} className="w-36" size="sm">
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
            description={gt(
              "A daily summary of work in progress, decisions waiting on you, and proposed next steps. The agent plans and asks for approval before acting.",
            )}
            control={
              <Switch
                aria-label={gt("Morning brief")}
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
                <T>Daily time</T>
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
                {actions.taskQuery.data?.timeZone ?? gt("Server time")}
              </span>
            </div>
            {actions.taskQuery.error ? (
              <p className="text-sm text-error">{actions.taskQuery.error}</p>
            ) : null}
          </SettingsRow>
        </>
      ) : null}
      {isElectron ? <MadoHomuDesktopLauncherSetting busy={busy} run={run} /> : null}
    </SettingsSection>
  );
}

function MadoHomuDesktopLauncherSetting({
  busy,
  run,
}: {
  busy: boolean;
  run: (action: () => Promise<boolean>) => Promise<void>;
}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const launcherEnabled = useAtomValue(madohomuDesktopLauncherEnabledAtom);
  const canWrite = useAtomValue(canUpdateMadoHomuDesktopLauncherAtom);
  return (
    <SettingsRow
      {...searchableSetting("madohomu-desktop-app")}
      description={gt("Add MadoHomu to this desktop's app launcher. Opens a separate window.")}
      control={
        <Switch
          aria-label={gt("MadoHomu desktop app")}
          checked={launcherEnabled === true}
          disabled={busy || !canWrite}
          onCheckedChange={(enabled) =>
            void run(() =>
              saveMadoHomuDesktopLauncherEnabled(enabled).catch(() => {
                toastManager.add({
                  type: "error",
                  title: gt("Could not save the MadoHomu desktop preference"),
                });
                return false;
              }),
            )
          }
        />
      }
    />
  );
}
