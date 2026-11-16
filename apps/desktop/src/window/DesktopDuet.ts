import { DesktopDuetSettings, type DesktopDuetWindowMode } from "@t3tools/contracts";
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
import { DUET_NAVIGATE_CHANNEL } from "../ipc/channels.ts";

export class DesktopDuetError extends Schema.TaggedError<DesktopDuetError>()("DesktopDuetError", {
  operation: Schema.Literals(["configure", "open", "merge"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not ${this.operation} T3 Duet.`;
  }
}

export class DesktopDuet extends Context.Service<
  DesktopDuet,
  {
    readonly configure: (settings: DesktopDuetSettings) => Effect.Effect<void, DesktopDuetError>;
    readonly open: Effect.Effect<void, DesktopDuetError>;
    readonly setWindowMode: (input: DesktopDuetWindowMode) => Effect.Effect<void, DesktopDuetError>;
  }
>()("@t3tools/desktop/window/DesktopDuet") {}

function duetDesktopEntry(execTarget: string, icon: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=T3 Duet",
    `Exec=${escapeDesktopEntryExecArgument(execTarget)} --duet`,
    "StartupWMClass=t3code-duet",
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
  let requested = args.includes("--duet");
  let configured = false;
  let settings: Required<DesktopDuetSettings> = {
    enabled: false,
    launcherEnabled: false,
    environmentId: null,
  };
  let window: Electron.BrowserWindow | null = null;
  let appliedLauncher: boolean | null = null;
  const entryPath = environment.path.join(
    environment.homeDirectory,
    ".local",
    "share",
    "applications",
    "t3code-duet.desktop",
  );
  const duetUrl = (location?: Omit<DesktopDuetWindowMode, "mode">) => {
    const route = new URL("https://route.invalid/duet");
    const environmentId = location?.environmentId ?? settings.environmentId;
    if (environmentId) route.searchParams.set("environmentId", environmentId);
    if (location?.threadId) route.searchParams.set("threadId", location.threadId);
    if (location?.tab) route.searchParams.set("tab", location.tab);
    const url = new URL(getDesktopUrl(environment.isDevelopment));
    url.hash = route.pathname + route.search;
    return url.href;
  };
  const report = (effect: Effect.Effect<void, DesktopDuetError>) => {
    runFork(
      effect.pipe(Effect.catch((error) => Effect.logWarning("T3 Duet action failed", error))),
    );
  };
  const openWindow = Effect.fn("DesktopDuet.openWindow")(
    function* (location: Omit<DesktopDuetWindowMode, "mode"> | undefined) {
      requested = true;
      if (!configured) return;
      if (window && !window.isDestroyed()) {
        if (location) {
          yield* Effect.tryPromise({
            try: () => window!.loadURL(duetUrl(location)),
            catch: (cause) => new DesktopDuetError({ operation: "open", cause }),
          });
        }
        yield* windows.reveal(window);
        requested = false;
        return;
      }
      const created = yield* windows.create(
        {
          width: 440,
          height: 820,
          minWidth: 360,
          minHeight: 480,
          title: "T3 Duet",
          show: false,
          autoHideMenuBar: true,
          webPreferences: {
            preload: environment.preloadPath,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            additionalArguments: ["--t3-duet-window"],
          },
        },
        { auxiliary: true, app: true },
      );
      window = created;
      yield* history.register(created.webContents, { surface: "duet" });
      created.once("closed", () => {
        if (window === created) window = null;
      });
      created.once("ready-to-show", () => report(windows.reveal(created)));
      created.on("page-title-updated", (event) => {
        event.preventDefault();
        created.setTitle("T3 Duet");
      });
      const origin = new URL(duetUrl());
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
        try: () => created.loadURL(duetUrl(location)),
        catch: (cause) => new DesktopDuetError({ operation: "open", cause }),
      });
      requested = false;
    },
    Effect.mapError((cause) => new DesktopDuetError({ operation: "open", cause })),
  );
  const open = openWindow(undefined).pipe(mutex.withPermits(1));
  const navigateMain = Effect.fn("DesktopDuet.navigateMain")(function* (
    view: "duet" | "code",
    location: Omit<DesktopDuetWindowMode, "mode">,
  ) {
    const existing = yield* windows.main;
    const target = yield* main.revealOrCreateMain;
    if (Option.isNone(existing)) {
      yield* Effect.tryPromise({
        try: () =>
          target.loadURL(
            view === "duet" ? duetUrl(location) : getDesktopUrl(environment.isDevelopment),
          ),
        catch: (cause) => new DesktopDuetError({ operation: "merge", cause }),
      });
    } else {
      target.webContents.send(DUET_NAVIGATE_CHANNEL, {
        view,
        ...location,
      });
    }
  });
  const configure = Effect.fn("DesktopDuet.configure")(
    function* (input: DesktopDuetSettings) {
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
      const previousEnvironment = settings.environmentId;
      const wasEnabled = settings.enabled;
      settings = next;
      configured = true;
      if (!next.enabled && wasEnabled) {
        requested = false;
        window?.close();
        window = null;
      } else if (window && previousEnvironment !== next.environmentId) {
        yield* Effect.tryPromise({
          try: () => window!.loadURL(duetUrl()),
          catch: (cause) => new DesktopDuetError({ operation: "configure", cause }),
        });
      }
      const launcher = next.enabled && next.launcherEnabled;
      if (appliedLauncher !== launcher) {
        if (environment.platform === "linux") {
          if (launcher) {
            yield* fileSystem.makeDirectory(environment.path.dirname(entryPath), {
              recursive: true,
            });
            yield* fileSystem.writeFileString(
              entryPath,
              // The main app's launcher installs its icon here (DesktopPreReadyPlatform).
              duetDesktopEntry(
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
                    arguments: "--duet",
                    iconPath: executable,
                    iconIndex: 0,
                    title: "T3 Duet",
                    description: "Open Duet",
                  },
                ]
              : [],
          );
        } else if (environment.platform === "darwin") {
          Electron.app.dock?.setMenu(
            Electron.Menu.buildFromTemplate(
              launcher ? [{ label: "T3 Duet", click: () => report(open) }] : [],
            ),
          );
        }
        appliedLauncher = launcher;
      }
      if (requested) yield* openWindow(undefined);
    },
    mutex.withPermits(1),
    Effect.mapError((cause) => new DesktopDuetError({ operation: "configure", cause })),
  );
  return DesktopDuet.of({
    configure,
    open,
    setWindowMode: Effect.fn("DesktopDuet.setWindowMode")(
      function* ({ mode, ...location }) {
        if (!settings.enabled) return;
        if (mode === "split") {
          yield* openWindow(location);
          yield* navigateMain("code", location);
        } else {
          yield* navigateMain("duet", location);
          window?.close();
          window = null;
        }
      },
      mutex.withPermits(1),
      Effect.mapError((cause) => new DesktopDuetError({ operation: "merge", cause })),
    ),
  });
});

export const layer = Layer.effect(DesktopDuet, make);
