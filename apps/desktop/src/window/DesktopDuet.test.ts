import * as Path from "effect/Path";
import { expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";

vi.mock("electron", () => ({}));
import * as DesktopDuet from "./DesktopDuet.ts";
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
  const file = "/home/user/.local/share/applications/t3code-duet.desktop";
  return Effect.gen(function* () {
    const duet = yield* DesktopDuet.DesktopDuet;
    yield* duet.configure({ enabled: false, launcherEnabled: true, environmentId: "local" });
    expect(files.size).toBe(0);
    yield* duet.configure({ enabled: true, launcherEnabled: true, environmentId: "local" });
    expect(files.get(file)).toContain("Name=T3 Duet");
    expect(files.get(file)).toContain('Exec="/opt/Homu Code.AppImage" --duet');
    expect(files.get(file)).toContain("StartupWMClass=t3code-duet");
    expect(files.get(file)).toContain(
      "Icon=/home/user/.local/share/icons/com.t3tools.T3Code.desktop.png",
    );
    yield* duet.configure({ enabled: true, launcherEnabled: false, environmentId: "local" });
    expect(files.has(file)).toBe(false);
    yield* duet.configure({ enabled: true, launcherEnabled: true, environmentId: "local" });
    yield* duet.configure({ enabled: false, launcherEnabled: true, environmentId: "local" });
    expect(files.has(file)).toBe(false);
  }).pipe(
    Effect.provide(
      DesktopDuet.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            layerDesktopEnvironment("/opt/Homu Code.AppImage"),
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
  "keeps the selected thread when splitting and merging and closes Duet when disabled",
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
      const duet = yield* DesktopDuet.DesktopDuet;
      const settings = { enabled: true, launcherEnabled: false, environmentId: "local" };
      yield* duet.configure(settings);
      expect(created).toBe(1);
      expect(new URL(loaded[0]!).pathname).toBe("/");
      expect(new URL(loaded[0]!).hash).toBe("#/duet?environmentId=local");
      yield* duet.open;
      expect(created).toBe(1);
      expect(revealed).toBe(1);
      const location = { environmentId: "local", threadId: "selected", tab: "tasks" as const };
      yield* duet.setWindowMode({ mode: "merged", ...location });
      expect(sent).toEqual([{ view: "duet", ...location }]);
      expect(closed).toBe(1);
      yield* duet.setWindowMode({ mode: "split", ...location });
      expect(created).toBe(2);
      expect(new URLSearchParams(new URL(loaded.at(-1)!).hash.split("?")[1]).get("threadId")).toBe(
        "selected",
      );
      expect(new URLSearchParams(new URL(loaded.at(-1)!).hash.split("?")[1]).get("tab")).toBe(
        "tasks",
      );
      expect(sent.at(-1)).toEqual({ view: "code", ...location });
      const loads = loaded.length;
      // The Duet window omits the destination, so the main window's choice stays.
      yield* duet.configure({ enabled: true, launcherEnabled: false });
      expect(loaded.length).toBe(loads);
      yield* duet.configure({ enabled: false, launcherEnabled: false });
      expect(closed).toBe(2);
      yield* duet.configure({ ...settings, enabled: false });
      expect(closed).toBe(2);
    }).pipe(
      Effect.provide(
        DesktopDuet.layer.pipe(
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
