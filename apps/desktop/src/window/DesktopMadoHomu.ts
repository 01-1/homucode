import { DesktopMadoHomuSettings, type DesktopMadoHomuWindowMode } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Electron from "electron";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { escapeDesktopEntryExecArgument } from "../app/DesktopLinuxUrlHandler.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";
import { MADOHOMU_NAVIGATE_CHANNEL } from "../ipc/channels.ts";

export class DesktopMadoHomuError extends Schema.TaggedError<DesktopMadoHomuError>()(
  "DesktopMadoHomuError",
  {
    operation: Schema.Literals(["configure", "open", "merge"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not ${this.operation} MadoHomu.`;
  }
}

export class DesktopMadoHomu extends Context.Service<
  DesktopMadoHomu,
  {
    readonly configure: (
      settings: DesktopMadoHomuSettings,
    ) => Effect.Effect<void, DesktopMadoHomuError>;
    readonly open: Effect.Effect<void, DesktopMadoHomuError>;
    readonly setWindowMode: (
      input: DesktopMadoHomuWindowMode,
    ) => Effect.Effect<void, DesktopMadoHomuError>;
  }
>()("@t3tools/desktop/window/DesktopMadoHomu") {}

// Launchers made before Duet was renamed MadoHomu still pass --duet.
export const isMadoHomuLaunch = (argv: ReadonlyArray<string>) =>
  argv.includes("--madohomu") || argv.includes("--duet");

function madohomuDesktopEntry(execTarget: string, icon: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=MadoHomu",
    `Exec=${escapeDesktopEntryExecArgument(execTarget)} --madohomu`,
    "StartupWMClass=t3code-madohomu",
    `Icon=${icon}`,
    "Terminal=false",
    "Categories=Development;",
    "",
  ].join("\n");
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const windows = yield* ElectronWindow.ElectronWindow;
  const main = yield* DesktopWindow.DesktopWindow;
  const shell = yield* ElectronShell.ElectronShell;
  const fileSystem = yield* FileSystem.FileSystem;
  const history = yield* DesktopRendererHistory.DesktopRendererHistory;
  const executablePath = yield* HostProcess.ExecutablePath;
  const executable = Option.getOrElse(environment.appImagePath, () => executablePath);
  const args = yield* HostProcess.Arguments;
  const mutex = yield* Semaphore.make(1);
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  let requested = isMadoHomuLaunch(args);
  let configured = false;
  let settings: Required<DesktopMadoHomuSettings> = {
    enabled: false,
    launcherEnabled: false,
    environmentId: null,
  };
  let window: { browser: Electron.BrowserWindow; explicitSplit: boolean } | null = null;
  let appliedLauncher: boolean | null = null;
  const entryPath = environment.path.join(
    environment.homeDirectory,
    ".local",
    "share",
    "applications",
    "t3code-madohomu.desktop",
  );
  const legacyEntryPath = environment.path.join(
    environment.path.dirname(entryPath),
    "t3code-duet.desktop",
  );
  const madohomuUrl = (location?: Omit<DesktopMadoHomuWindowMode, "mode">) => {
    const route = new URL("https://route.invalid/madohomu");
    // Launches follow the saved destination in the renderer. Split and merge carry an explicit route.
    const environmentId = location?.environmentId;
    if (environmentId) route.searchParams.set("environmentId", environmentId);
    if (location?.threadId) route.searchParams.set("threadId", location.threadId);
    const url = new URL(getDesktopUrl(environment.isDevelopment));
    url.hash = route.pathname + route.search;
    return url.href;
  };
  const windowEnvironmentId = (browser: Electron.BrowserWindow) => {
    const route = browser.webContents.getURL().split("#")[1];
    return new URLSearchParams(route?.split("?")[1]).get("environmentId");
  };
  const report = (effect: Effect.Effect<void, DesktopMadoHomuError>) => {
    runFork(
      effect.pipe(Effect.catch((error) => Effect.logWarning("MadoHomu action failed", error))),
    );
  };
  const openWindow = Effect.fn("DesktopMadoHomu.openWindow")(
    function* (location: Omit<DesktopMadoHomuWindowMode, "mode"> | undefined) {
      requested = true;
      if (!configured) return;
      const existing = window;
      if (existing && !existing.browser.isDestroyed()) {
        // Clicking a thread also adds an environment to the route. Only Split pins the window.
        const routedEnvironment = windowEnvironmentId(existing.browser);
        if (
          location ||
          (!existing.explicitSplit &&
            routedEnvironment !== null &&
            routedEnvironment !== settings.environmentId)
        ) {
          yield* Effect.tryPromise({
            try: () => existing.browser.loadURL(madohomuUrl(location)),
            catch: (cause) => new DesktopMadoHomuError({ operation: "open", cause }),
          });
          existing.explicitSplit = location !== undefined;
        }
        yield* windows.reveal(existing.browser);
        requested = false;
        return;
      }
      const created = yield* windows.create(
        {
          width: 1100,
          height: 720,
          minWidth: 360,
          minHeight: 480,
          title: "MadoHomu",
          show: false,
          autoHideMenuBar: true,
          webPreferences: {
            preload: environment.preloadPath,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            additionalArguments: ["--t3-madohomu-window"],
          },
        },
        { auxiliary: true, app: true },
      );
      window = { browser: created, explicitSplit: location !== undefined };
      yield* history.register(created.webContents, { surface: "madohomu" });
      created.once("closed", () => {
        if (window?.browser === created) window = null;
      });
      created.once("ready-to-show", () => report(windows.reveal(created)));
      created.on("page-title-updated", (event) => {
        event.preventDefault();
        created.setTitle("MadoHomu");
      });
      const origin = new URL(madohomuUrl());
      const allowNavigation = (value: string) => {
        try {
          const url = new URL(value);
          return url.protocol === origin.protocol && url.host === origin.host;
        } catch {
          return false;
        }
      };
      created.webContents.on("will-navigate", (event, url) => {
        if (!allowNavigation(url)) event.preventDefault();
      });
      created.webContents.on("will-redirect", (event, url) => {
        if (!allowNavigation(url)) event.preventDefault();
      });
      created.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:|^mailto:/i.test(url)) runFork(shell.openExternal(url));
        return { action: "deny" };
      });
      yield* Effect.tryPromise({
        try: () => created.loadURL(madohomuUrl(location)),
        catch: (cause) => new DesktopMadoHomuError({ operation: "open", cause }),
      });
      requested = false;
    },
    Effect.mapError((cause) => new DesktopMadoHomuError({ operation: "open", cause })),
  );
  const open = openWindow(undefined).pipe(mutex.withPermits(1));
  const navigateMain = Effect.fn("DesktopMadoHomu.navigateMain")(function* (
    view: "madohomu" | "code",
    location: Omit<DesktopMadoHomuWindowMode, "mode">,
  ) {
    const existing = yield* windows.main;
    const target = yield* main.revealOrCreateMain;
    if (Option.isNone(existing)) {
      yield* Effect.tryPromise({
        try: () =>
          target.loadURL(
            view === "madohomu" ? madohomuUrl(location) : getDesktopUrl(environment.isDevelopment),
          ),
        catch: (cause) => new DesktopMadoHomuError({ operation: "merge", cause }),
      });
    } else {
      target.webContents.send(MADOHOMU_NAVIGATE_CHANNEL, {
        view,
        ...location,
      });
    }
  });
  const configure = Effect.fn("DesktopMadoHomu.configure")(
    function* (input: DesktopMadoHomuSettings) {
      const next = {
        enabled: input.enabled,
        launcherEnabled: input.launcherEnabled,
        environmentId:
          input.environmentId === undefined ? settings.environmentId : input.environmentId,
      };
      if (
        configured &&
        settings.enabled === next.enabled &&
        settings.launcherEnabled === next.launcherEnabled &&
        settings.environmentId === next.environmentId
      )
        return;
      const wasEnabled = settings.enabled;
      settings = next;
      configured = true;
      if (!next.enabled && wasEnabled) {
        requested = false;
        const pinned = window?.explicitSplit ? windowEnvironmentId(window.browser) : null;
        if (window && (pinned === null || pinned === next.environmentId)) {
          window.browser.close();
          window = null;
        }
      }
      const launcher = next.enabled && next.launcherEnabled;
      if (appliedLauncher !== launcher) {
        if (environment.platform === "linux") {
          if (yield* fileSystem.exists(legacyEntryPath)) yield* fileSystem.remove(legacyEntryPath);
          if (launcher) {
            yield* fileSystem.makeDirectory(environment.path.dirname(entryPath), {
              recursive: true,
            });
            yield* fileSystem.writeFileString(
              entryPath,
              // The main app's launcher installs its icon here (DesktopPreReadyPlatform).
              madohomuDesktopEntry(
                executable,
                environment.path.join(
                  environment.homeDirectory,
                  ".local",
                  "share",
                  "icons",
                  `${environment.linuxDesktopEntryName}.png`,
                ),
              ),
            );
          } else if (yield* fileSystem.exists(entryPath)) yield* fileSystem.remove(entryPath);
        } else if (environment.platform === "win32") {
          Electron.app.setUserTasks(
            launcher
              ? [
                  {
                    program: executable,
                    arguments: "--madohomu",
                    iconPath: executable,
                    iconIndex: 0,
                    title: "MadoHomu",
                    description: "Open MadoHomu",
                  },
                ]
              : [],
          );
        } else if (environment.platform === "darwin") {
          Electron.app.dock?.setMenu(
            Electron.Menu.buildFromTemplate(
              launcher ? [{ label: "MadoHomu", click: () => report(open) }] : [],
            ),
          );
        }
        appliedLauncher = launcher;
      }
      if (requested) yield* openWindow(undefined);
    },
    mutex.withPermits(1),
    Effect.mapError((cause) => new DesktopMadoHomuError({ operation: "configure", cause })),
  );
  return DesktopMadoHomu.of({
    configure,
    open,
    setWindowMode: Effect.fn("DesktopMadoHomu.setWindowMode")(
      function* ({ mode, ...location }) {
        if (!settings.enabled && !location.environmentId) return;
        if (mode === "split") {
          yield* openWindow(location);
          yield* navigateMain("code", location);
        } else {
          yield* navigateMain("madohomu", location);
          window?.browser.close();
          window = null;
        }
      },
      mutex.withPermits(1),
      Effect.mapError((cause) => new DesktopMadoHomuError({ operation: "merge", cause })),
    ),
  });
});

export const layer = Layer.effect(DesktopMadoHomu, make);
