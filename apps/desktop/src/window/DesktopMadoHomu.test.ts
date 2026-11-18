import * as Path from "effect/Path";
import { expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";

vi.mock("electron", () => ({}));
import * as DesktopMadoHomu from "./DesktopMadoHomu.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";

const layerDesktopEnvironment = (appImagePath?: string) =>
  DesktopEnvironment.layer({
    dirname: "/app/dist-electron",
    homeDirectory: "/home/user",
    platform: "linux",
    processArch: "x64",
    appVersion: "0.0.0",
    appPath: "/app",
    isPackaged: true,
    resourcesPath: "/app/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(Layer.mergeAll(Path.layer, DesktopConfig.layerTest({ APPIMAGE: appImagePath }))),
  );

it.effect("adds and removes the Linux launcher only while both opt-ins are enabled", () => {
  const files = new Map<string, string>();
  const file = "/home/user/.local/share/applications/t3code-madohomu.desktop";
  const legacyFile = "/home/user/.local/share/applications/t3code-duet.desktop";
  files.set(legacyFile, "Exec=t3code --duet");
  return Effect.gen(function* () {
    const madohomu = yield* DesktopMadoHomu.DesktopMadoHomu;
    yield* madohomu.configure({ enabled: false, launcherEnabled: true, environmentId: "local" });
    expect(files.size).toBe(0);
    yield* madohomu.configure({ enabled: true, launcherEnabled: true, environmentId: "local" });
    expect(files.get(file)).toContain("Name=MadoHomu");
    expect(files.get(file)).toContain('Exec="/opt/My Apps/HomuCode.AppImage" --madohomu');
    expect(files.get(file)).toContain("StartupWMClass=t3code-madohomu");
    expect(files.get(file)).toContain(
      "Icon=/home/user/.local/share/icons/com.t3tools.T3Code.desktop.png",
    );
    yield* madohomu.configure({ enabled: true, launcherEnabled: false, environmentId: "local" });
    expect(files.has(file)).toBe(false);
    yield* madohomu.configure({ enabled: true, launcherEnabled: true, environmentId: "local" });
    yield* madohomu.configure({ enabled: false, launcherEnabled: true, environmentId: "local" });
    expect(files.has(file)).toBe(false);
  }).pipe(
    Effect.provide(
      DesktopMadoHomu.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            layerDesktopEnvironment("/opt/My Apps/HomuCode.AppImage"),
            Layer.mock(ElectronWindow.ElectronWindow, {}),
            Layer.mock(DesktopWindow.DesktopWindow, {}),
            Layer.mock(ElectronShell.ElectronShell, {}),
            Layer.mock(DesktopRendererHistory.DesktopRendererHistory, {}),
            Layer.succeed(HostProcess.Arguments, []),
            FileSystem.layerNoop({
              exists: (path) => Effect.succeed(files.has(path)),
              makeDirectory: () => Effect.void,
              writeFileString: (path, value) =>
                Effect.sync(() => {
                  files.set(path, value);
                }),
              remove: (path) =>
                Effect.sync(() => {
                  files.delete(path);
                }),
            }),
          ),
        ),
      ),
    ),
  );
});

it.effect(
  "launches on the default route and preserves an explicitly split thread across destination changes",
  () => {
    const loaded: string[] = [];
    const sent: unknown[] = [];
    let closed = 0;
    let created = 0;
    let revealed = 0;
    const detached = {
      once: () => undefined,
      on: () => undefined,
      isDestroyed: () => false,
      close: () => {
        closed++;
      },
      loadURL: async (url: string) => {
        loaded.push(url);
      },
      webContents: {
        getURL: () => loaded.at(-1) ?? "",
        on: () => undefined,
        setWindowOpenHandler: () => undefined,
      },
    } as unknown as import("electron").BrowserWindow;
    const main = {
      webContents: {
        send: (_channel: string, value: unknown) => {
          sent.push(value);
        },
      },
    } as unknown as import("electron").BrowserWindow;
    return Effect.gen(function* () {
      const madohomu = yield* DesktopMadoHomu.DesktopMadoHomu;
      const settings = { enabled: true, launcherEnabled: false, environmentId: "local" };
      yield* madohomu.configure(settings);
      expect(created).toBe(1);
      expect(new URL(loaded[0]!).pathname).toBe("/");
      expect(new URL(loaded[0]!).hash).toBe("#/madohomu");
      yield* madohomu.open;
      expect(created).toBe(1);
      expect(revealed).toBe(1);
      const location = { environmentId: "local", threadId: "selected" };
      yield* madohomu.setWindowMode({ mode: "merged", ...location });
      expect(sent).toEqual([{ view: "madohomu", ...location }]);
      expect(closed).toBe(1);
      yield* madohomu.setWindowMode({ mode: "split", ...location });
      expect(created).toBe(2);
      expect(new URLSearchParams(new URL(loaded.at(-1)!).hash.split("?")[1]).get("threadId")).toBe(
        "selected",
      );
      expect(sent.at(-1)).toEqual({ view: "code", ...location });
      const loads = loaded.length;
      yield* madohomu.configure({ ...settings, environmentId: "remote" });
      expect(loaded.length).toBe(loads);
      yield* madohomu.configure({ ...settings, enabled: false, environmentId: "remote" });
      expect(closed).toBe(1);
      yield* madohomu.configure(settings);
      yield* madohomu.configure({ ...settings, enabled: false });
      expect(closed).toBe(2);
      yield* madohomu.configure({ ...settings, enabled: false });
      expect(closed).toBe(2);
    }).pipe(
      Effect.provide(
        DesktopMadoHomu.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              layerDesktopEnvironment(),
              Layer.mock(ElectronWindow.ElectronWindow, {
                main: Effect.succeedSome(main),
                create: () =>
                  Effect.sync(() => {
                    created++;
                    return detached;
                  }),
                reveal: () =>
                  Effect.sync(() => {
                    revealed++;
                  }),
              }),
              Layer.mock(DesktopWindow.DesktopWindow, { revealOrCreateMain: Effect.succeed(main) }),
              Layer.mock(ElectronShell.ElectronShell, {}),
              Layer.mock(DesktopRendererHistory.DesktopRendererHistory, {
                register: () => Effect.void,
              }),
              Layer.succeed(HostProcess.Arguments, ["t3", "--duet"]),
              FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
            ),
          ),
        ),
      ),
    );
  },
);
