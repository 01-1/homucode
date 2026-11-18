import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import type { BuildToolsRequest, EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { StagedBuildSettingsRow } from "./StagedBuildSettingsRow";

export function BuildToolsSetup({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const run = useAtomCommand(serverEnvironment.buildToolsRun);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canRun = useAtomValue(serverEnvironment.buildToolsRun.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    serverEnvironment.buildToolsState({ environmentId, input: {} }),
  );
  const state = query.data;
  const [ref, setRef] = useState("origin/main");
  const [testFile, setTestFile] = useState("");
  const [stagedFile, setStagedFile] = useState("");
  const [sha256, setSha256] = useState("");
  const [confirmation, setConfirmation] = useState<BuildToolsRequest["action"] | null>(null);
  const action = (action: BuildToolsRequest["action"]) =>
    void run({
      environmentId,
      input: {
        action,
        ref,
        testFiles: testFile
          .split("\n")
          .map((file) => file.trim())
          .filter(Boolean),
        stagedFile,
        sha256,
        undoneAs: "",
      },
    });
  const patch = (patch: Parameters<typeof update>[0]["input"]["patch"]) =>
    void update({ environmentId, input: { patch } });
  const busy = state?.phase === "running";
  return (
    <div className="grid gap-6">
      <SettingsSection title="Build folder and launcher">
        {(
          [
            ["buildRepoPath", "T3 Code checkout", "Path to this machine's HomuCode checkout"],
            ["buildBoatCliPath", "Boat CLI", "boat"],
            ["buildMachineType", "Cloud machine type", "large"],
            ["buildOutputFolder", "Build output folder", "~/hold/t3-builds"],
            [
              "buildAppImageFolder",
              "AppImage build folder",
              state?.buildFolder ?? "Folder containing the running AppImage",
            ],
          ] as const
        ).map(([key, title, placeholder]) => (
          <SettingsRow
            key={key}
            title={title}
            control={
              <Input
                key={`${key}:${settings[key]}`}
                defaultValue={settings[key]}
                placeholder={placeholder}
                disabled={!canWrite || busy}
                onBlur={(event) => {
                  if (event.target.value !== settings[key]) patch({ [key]: event.target.value });
                }}
              />
            }
          />
        ))}
        <p className="text-sm text-muted-foreground">
          The build loader launches the newest AppImage in this folder. The default is the running
          AppImage's folder.
        </p>
        <StagedBuildSettingsRow environmentId={environmentId} />
      </SettingsSection>
      <SettingsSection title="Cloud build">
        <SettingsRow
          title="Enable cloud builds"
          description="Build or test a committed revision on a disposable boat.dev machine. Install the boat CLI and run boat login on this machine first."
          control={
            <Checkbox
              checked={settings.cloudBuildEnabled}
              disabled={!canWrite || busy}
              onCheckedChange={(value) => patch({ cloudBuildEnabled: Boolean(value) })}
            />
          }
        />
        <SettingsRow
          title="Revision"
          control={
            <Input
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              aria-label="Build revision"
            />
          }
        />
        <SettingsRow
          title="Focused test files"
          description="One path per line."
          control={
            <Input
              value={testFile}
              onChange={(event) => setTestFile(event.target.value)}
              aria-label="Focused test files"
            />
          }
        />
        <div className="flex gap-2">
          <Button
            disabled={!settings.cloudBuildEnabled || !canRun || busy}
            onClick={() => setConfirmation("cloud-build")}
          >
            Build AppImage
          </Button>
          <Button
            variant="outline"
            disabled={!settings.cloudBuildEnabled || !canRun || busy || !testFile.trim()}
            onClick={() => setConfirmation("cloud-test")}
          >
            Run focused tests
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title="Android APK">
        <SettingsRow
          title="Enable Android builds"
          description="Build a signed development APK on boat.dev. Uses this machine's existing Android signing key."
          control={
            <Checkbox
              checked={settings.androidBuildEnabled}
              disabled={!canWrite || busy}
              onCheckedChange={(value) => patch({ androidBuildEnabled: Boolean(value) })}
            />
          }
        />
        <Button
          disabled={!settings.androidBuildEnabled || !canRun || busy}
          onClick={() => setConfirmation("android")}
        >
          Build Android APK
        </Button>
        <SettingsRow
          title="Serve APKs on LAN"
          description="Serve ~/app/mobile on port 8767 until switched off or this server stops."
          control={
            <Checkbox
              checked={Boolean(state?.lanUrl)}
              disabled={!canRun || (!settings.androidBuildEnabled && !state?.lanUrl)}
              onCheckedChange={(value) => action(value ? "serve" : "stop-serving")}
            />
          }
        />
        {state?.lanUrl ? (
          <p className="break-all text-sm">
            {state.lanUrl}
            {state.artifactPath?.split("/").at(-1) ?? "<APK filename>"}
          </p>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Load build">
        <SettingsRow
          title="Enable loading builds"
          description={
            state?.appImageAvailable
              ? "Verify a staged AppImage and restart T3 on it, with automatic rollback if it fails to return."
              : "Not available: this server is not running inside an AppImage install."
          }
          control={
            <Checkbox
              checked={settings.loadBuildEnabled}
              disabled={!canWrite || !state?.appImageAvailable || busy}
              onCheckedChange={(value) => patch({ loadBuildEnabled: Boolean(value) })}
            />
          }
        />
        <SettingsRow
          title="Staged AppImage"
          control={
            <Input
              value={stagedFile}
              onChange={(event) => setStagedFile(event.target.value)}
              placeholder="/path/to/build.AppImage.staged"
            />
          }
        />
        <SettingsRow
          title="SHA-256"
          control={<Input value={sha256} onChange={(event) => setSha256(event.target.value)} />}
        />
        <Button
          disabled={
            !canRun ||
            !settings.loadBuildEnabled ||
            !state?.appImageAvailable ||
            busy ||
            !stagedFile ||
            !/^[a-f\d]{64}$/i.test(sha256)
          }
          onClick={() => setConfirmation("load")}
        >
          Load staged build
        </Button>
      </SettingsSection>
      {confirmation ? (
        <div className="grid gap-2">
          <p className="text-sm">
            {confirmation === "load"
              ? "This restarts T3 Code. The loader restores the previous build if the new one fails."
              : "This starts a disposable cloud machine using your boat.dev account."}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                action(confirmation);
                setConfirmation(null);
              }}
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <div role="status" className="grid gap-2 text-sm">
        <p>{query.error ?? state?.message ?? "Loading build tool status…"}</p>
        {state?.artifactPath ? <p className="break-all">{state.artifactPath}</p> : null}
        {state?.output ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{state.output}</pre>
        ) : null}
      </div>
    </div>
  );
}
