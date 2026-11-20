import { FEATURE_OFFERS } from "@t3tools/client-runtime/feature-offers";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { Preferences } from "../../persistence/mobile-preferences";

const { Children, mocks } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => children,
  mocks: {
    preferences: {} as Preferences,
    savedPreferences: {} as Preferences,
    settings: {} as typeof DEFAULT_SERVER_SETTINGS,
    descriptor: {
      serverVersion: "0.1.10-homu.98",
      capabilities: { homuSetup: true, buildTools: true, statusLine: true },
    },
    otherEnvironments: [] as Array<{
      environmentId: string;
      label: string;
      connection: { phase: string };
      serverConfig: {
        settings: typeof DEFAULT_SERVER_SETTINGS;
        environment: {
          serverVersion: string;
          capabilities: { homuSetup: boolean; buildTools: boolean; statusLine: boolean };
        };
      };
    }>,
    readOnly: false,
    preferenceFailure: false,
    preferenceGate: null as Promise<{ _tag: "Success" | "Failure" }> | null,
    gateFinalWrite: false,
    update: vi.fn(),
  },
}));

vi.mock("react-native", () => ({
  View: Children,
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onInput={(event) => onChangeText(event.currentTarget.value)}
      readOnly={false}
    />
  ),
}));
vi.mock("../../components/ui/SegmentedControl", () => ({
  SegmentedControl: () => null,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string | boolean) =>
    atom === "preferences"
      ? AsyncResult.success(mocks.preferences)
      : atom === "persisted-preferences"
        ? AsyncResult.success(mocks.savedPreferences)
        : atom === "settings-sync"
          ? (mocks.preferences.settingsSyncEnabled ?? false)
          : atom,
  useAtomSet:
    () =>
    async (
      update: Partial<Preferences> | { transform: (current: Preferences) => Partial<Preferences> },
    ) => {
      const previous = mocks.preferences;
      const patch = "transform" in update ? update.transform(mocks.preferences) : update;
      mocks.preferences = { ...mocks.preferences, ...patch };
      const result =
        mocks.preferenceGate && (!mocks.gateFinalWrite || patch.featureOffersDraft === null)
          ? await mocks.preferenceGate
          : { _tag: mocks.preferenceFailure ? "Failure" : "Success" };
      if (result._tag === "Failure") mocks.preferences = previous;
      else mocks.savedPreferences = mocks.preferences;
      return result;
    },
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: "preferences",
  persistedMobilePreferencesAtom: "persisted-preferences",
  mobileSettingsSyncEnabledAtom: "settings-sync",
  updateMobilePreferencesAtom: "update-preferences",
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      ...mocks.otherEnvironments,
      {
        environmentId: "server",
        label: "pbox",
        connection: { phase: "connected" },
        serverConfig: { settings: mocks.settings, environment: mocks.descriptor },
      },
    ],
  }),
}));
vi.mock("../../state/session", () => ({
  useEnvironmentsWithScope: (_environments: unknown, scope: string) =>
    new Set(
      scope === "settings:write" && mocks.readOnly
        ? []
        : ["server", ...mocks.otherEnvironments.map((environment) => environment.environmentId)],
    ),
}));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: (id: string) =>
    id === "server"
      ? { settings: mocks.settings, environment: mocks.descriptor }
      : mocks.otherEnvironments.find((environment) => environment.environmentId === id)
          ?.serverConfig,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: { permissionAtom: () => true } },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.update }));
vi.mock("../../lib/strayTouchGuard", () => ({
  STRAY_TOUCH_GUARD_MS: 0,
  useHoldTouchesOnAppear: () => {},
}));
vi.mock("../home/home-launch-snapshot", () => ({ coverHomeForLaunchSnapshot: () => {} }));
vi.mock("../settings/SetupBehaviorSettings", () => ({
  MobileBuildTools: () => <span>Build controls</span>,
  MobileThisDeviceName: () => null,
}));
vi.mock("../../components/ui/AppText", () => ({ AppText: Children }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: Children }));
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => {
    const [open, setOpen] = useState(true);
    return open ? (
      <div role="dialog">
        {children}
        <button
          onClick={() => {
            setOpen(false);
            onClose();
          }}
        >
          Dismiss sheet
        </button>
      </div>
    ) : null;
  },
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button onClick={onPress}>{label}</button>
  ),
}));
vi.mock("../../components/ui/ListChoiceRow", () => ({
  ListChoiceRow: ({
    label,
    description,
    selected,
    disabled,
    onPress,
  }: {
    label: string;
    description?: string;
    selected: boolean;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <div>
      <button aria-pressed={selected} disabled={disabled} onClick={onPress}>
        {label}
      </button>
      {description}
    </div>
  ),
}));
vi.mock("../settings/components/SettingsSwitchRow", () => ({
  SettingsSwitchRow: ({
    label,
    value,
    onValueChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onValueChange(!value)}
    >
      {label}
    </button>
  ),
}));

import { FeatureOffersSheet } from "./FeatureOffersSheet";

function setup() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.preferences = {
    featureOffersSeen: FEATURE_OFFERS.filter((offer) => offer.platform === "mobile").map(
      (offer) => offer.id,
    ),
  };
  mocks.savedPreferences = mocks.preferences;
  mocks.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    buildToolsSettingsVisible: false,
    featureOffersSeen: FEATURE_OFFERS.filter(
      (offer) => offer.id !== "settings-sync" && offer.id !== "building-t3",
    ).map((offer) => offer.id),
  };
  mocks.descriptor = {
    serverVersion: "0.1.10-homu.98",
    capabilities: { homuSetup: true, buildTools: true, statusLine: true },
  };
  mocks.otherEnvironments = [];
  mocks.readOnly = false;
  mocks.preferenceFailure = false;
  mocks.preferenceGate = null;
  mocks.gateFinalWrite = false;
  mocks.update.mockReset();
  mocks.update.mockResolvedValue({ _tag: "Success" });
  const container = document.createElement("div");
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (entry) => entry.textContent === label,
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  };
  act(() => root.render(<FeatureOffersSheet active />));
  return { container, root, click, [Symbol.dispose]: () => act(() => root.unmount()) };
}

it.each(["Not now", "Dismiss sheet"])(
  "%s closes without a server request and restores the unfinished choices on next launch",
  async (dismiss) => {
    using screen = setup();
    await screen.click("Settings sync");
    await screen.click("Set up building HomuCode");
    await screen.click("Next");
    expect(screen.container.textContent).toContain("Build controls");
    const draft = mocks.preferences.featureOffersDraft;
    await screen.click(dismiss);
    if (dismiss === "Not now") await screen.click("On next launch");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.preferences.featureOffersDraft).toEqual(draft);

    act(() => screen.root.render(null));
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.textContent).toContain("Build controls");
    await screen.click("Back");
    expect(
      [...screen.container.querySelectorAll('[role="switch"]')].map((button) =>
        button.getAttribute("aria-checked"),
      ),
    ).toEqual(["true", "true"]);
  },
);

it("reports a failed Save and keeps the choices until a successful retry", async () => {
  using screen = setup();
  await screen.click("Settings sync");
  await screen.click("Set up building HomuCode");
  await screen.click("Next");
  const draft = mocks.preferences.featureOffersDraft;
  mocks.update.mockResolvedValueOnce({ _tag: "Failure" });
  await screen.click("Save");
  expect(screen.container.textContent).toContain("Could not save HomuCode features. Try again.");
  expect(mocks.preferences.featureOffersDraft?.selected).toEqual(draft?.selected);
  expect(mocks.preferences.settingsSyncEnabled).toBeUndefined();

  await screen.click("Back");
  await screen.click("Set up building HomuCode");
  await screen.click("Save");
  expect(mocks.update).toHaveBeenLastCalledWith({
    environmentId: "server",
    input: { patch: expect.objectContaining({ buildToolsSettingsVisible: false }) },
  });
  expect(mocks.preferences.featureOffersDraft).toBeNull();
  expect(mocks.preferences.settingsSyncEnabled).toBe(true);
});

it("keeps an arbitrary snooze duration across restarts and restores choices when it expires", async () => {
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  using screen = setup();
  await screen.click("Settings sync");
  await screen.click("Not now");
  await screen.click("Snooze");
  expect(screen.container.textContent).toContain("Enter a positive duration.");
  const input = screen.container.querySelector("input")!;
  act(() => {
    input.value = "2.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await screen.click("Snooze");
  expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.preferences.featureOffersSnoozedUntil).toBe("2026-11-19T14:30:00.000Z");
  expect(mocks.update).not.toHaveBeenCalled();
  act(() => screen.root.render(null));
  act(() => screen.root.render(<FeatureOffersSheet active />));
  expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(9_000_000));
  expect(screen.container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    [...screen.container.querySelectorAll('[role="switch"]')].map((button) =>
      button.getAttribute("aria-checked"),
    ),
  ).toEqual(["true", "false"]);
});

it.each(["upstream", "read-only"])(
  "shows unavailable %s features while saving device choices without a server mutation",
  async (kind) => {
    using screen = setup();
    if (kind === "upstream") {
      mocks.descriptor = {
        serverVersion: "0.1.10",
        capabilities: { homuSetup: false, buildTools: false, statusLine: true },
      };
    } else mocks.readOnly = true;
    mocks.preferences = { ...mocks.preferences, fasterPhoneLaunch: true };
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.textContent).toContain("pbox");
    expect(screen.container.textContent).toContain(
      kind === "upstream" ? "does not support this HomuCode feature" : "read-only",
    );
    const building = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Set up building HomuCode",
    );
    expect(building?.disabled).toBe(true);
    await screen.click("Settings sync");
    await screen.click("Save");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.preferences.settingsSyncEnabled).toBe(true);
    act(() => screen.root.render(null));
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.preferences.featureOffersDraft?.offered).toContain("building-t3");
    expect(mocks.preferences.featureOffersDraft?.selected).toContain("faster-phone-launch");

    mocks.preferences = {
      ...mocks.preferences,
      fasterPhoneLaunch: false,
      featureOffersSeen: mocks.preferences.featureOffersSeen?.filter(
        (id) => id !== "faster-phone-launch",
      ),
    };
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.textContent).toContain("Faster phone launch");
    await screen.click("Save");
    expect(mocks.preferences.fasterPhoneLaunch).toBe(false);
    expect(mocks.preferences.featureOffersDraft?.offered).toContain("building-t3");
    act(() => screen.root.render(null));

    mocks.readOnly = false;
    mocks.descriptor = {
      serverVersion: "0.1.10-homu.98",
      capabilities: { homuSetup: true, buildTools: true, statusLine: true },
    };
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.querySelector('[role="dialog"]')).not.toBeNull();
  },
);

it("chooses a compatible server before upstream and keeps drafts separate when switching servers", async () => {
  using screen = setup();
  mocks.otherEnvironments = [
    {
      environmentId: "main",
      label: "main",
      connection: { phase: "connected" },
      serverConfig: {
        settings: mocks.settings,
        environment: {
          serverVersion: "0.1.10",
          capabilities: { homuSetup: false, buildTools: false, statusLine: true },
        },
      },
    },
  ];
  act(() => screen.root.render(<FeatureOffersSheet active />));
  expect(screen.container.querySelector('[aria-pressed="true"]')?.textContent).toBe("pbox");
  await screen.click("Set up building HomuCode");
  await screen.click("Next");
  await screen.click("main");
  await screen.click("Settings sync");
  await screen.click("pbox");
  expect(screen.container.textContent).toContain("Build controls");
  expect(mocks.preferences.featureOffersDrafts?.main?.selected).toContain("settings-sync");
  await screen.click("Save");
  expect(mocks.update).toHaveBeenLastCalledWith({
    environmentId: "server",
    input: { patch: expect.objectContaining({ buildToolsSettingsVisible: true }) },
  });
  expect(mocks.preferences.featureOffersDrafts?.main).toBeDefined();
  expect(mocks.preferences.featureOffersDrafts?.server).toBeUndefined();
});

it.each(["Save", "Dismiss sheet", "In 1 hour"])(
  "keeps choices recoverable when the phone write for %s fails",
  async (action) => {
    using screen = setup();
    await screen.click("Settings sync");
    const draft = mocks.preferences.featureOffersDraft;
    if (action === "In 1 hour") await screen.click("Not now");
    mocks.preferenceFailure = true;
    await screen.click(action);
    expect(screen.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(screen.container.textContent).toContain(
      "Could not save choices on this phone. Try again.",
    );
    expect(mocks.preferences.featureOffersDraft).toEqual(draft);
    mocks.preferenceFailure = false;
    await screen.click(action);
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("returns a restored draft to the first page when its saved follow-up is unavailable", () => {
  using screen = setup();
  act(() => screen.root.render(null));
  mocks.preferences = {
    ...mocks.preferences,
    featureOffersDraft: {
      environmentId: "server",
      selected: ["building-t3"],
      step: 1,
      page: "device-name",
    },
  };
  act(() => screen.root.render(<FeatureOffersSheet active />));
  expect(screen.container.textContent).not.toContain("Build controls");
  expect(screen.container.textContent).toContain("Set up building HomuCode");
});

it("keeps the sheet and its retry error through an optimistic snooze rollback", async () => {
  using screen = setup();
  await screen.click("Settings sync");
  const draft = mocks.preferences.featureOffersDraft;
  await screen.click("Not now");
  const gate = Promise.withResolvers<{ _tag: "Failure" }>();
  mocks.preferenceGate = gate.promise;
  await screen.click("In 1 hour");
  expect(mocks.preferences.featureOffersSnoozedUntil).toBeDefined();
  act(() => screen.root.render(<FeatureOffersSheet active />));
  expect(screen.container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => gate.resolve({ _tag: "Failure" }));
  act(() => screen.root.render(<FeatureOffersSheet active />));
  expect(screen.container.textContent).toContain(
    "Could not save choices on this phone. Try again.",
  );
  expect(mocks.preferences.featureOffersDraft).toEqual(draft);
  mocks.preferenceGate = null;
  await screen.click("In 1 hour");
  expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
});

it.each([false, true])(
  "keeps the save scoped after a server acknowledgement and failed phone write (relaunch %s)",
  async (relaunch) => {
    using screen = setup();
    act(() => screen.root.render(null));
    mocks.preferences = {
      ...mocks.preferences,
      featureOffersSeen: ["settings-sync", "faster-phone-launch"],
    };
    mocks.savedPreferences = mocks.preferences;
    const seenBeforeSave = mocks.settings.featureOffersSeen.filter((id) => id !== "subagents");
    const other = {
      environmentId: "omen",
      label: "omen",
      connection: { phase: "connected" },
      serverConfig: {
        settings: {
          ...mocks.settings,
          featureOffersSeen: seenBeforeSave,
          preferNativeSubagents: true,
        },
        environment: mocks.descriptor,
      },
    };
    mocks.otherEnvironments = [other];
    act(() => screen.root.render(<FeatureOffersSheet active />));
    await screen.click("Homu delegation (delegate_task)");
    const gate = Promise.withResolvers<{ _tag: "Failure" }>();
    mocks.preferenceGate = gate.promise;
    mocks.gateFinalWrite = true;
    mocks.update.mockImplementationOnce(async () => {
      other.serverConfig.settings = {
        ...other.serverConfig.settings,
        featureOffersSeen: FEATURE_OFFERS.map((offer) => offer.id),
        statusLineEnabled: false,
      };
      return { _tag: "Success" };
    });
    await screen.click("Save");
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.querySelector('[aria-pressed="true"]')?.textContent).toBe("omen");
    await act(async () => gate.resolve({ _tag: "Failure" }));
    act(() => screen.root.render(<FeatureOffersSheet active />));
    expect(screen.container.textContent).toContain(
      "Could not save choices on this phone. Try again.",
    );
    expect(screen.container.querySelector('[aria-pressed="true"]')?.textContent).toBe("omen");
    expect(
      [...screen.container.querySelectorAll('[role="switch"]')].map((button) => button.textContent),
    ).toEqual(["Set up building HomuCode"]);
    mocks.preferenceGate = null;
    if (relaunch) {
      await screen.click("Homu delegation (delegate_task)");
      await screen.click("Not now");
      await screen.click("On next launch");
      expect(mocks.preferences.featureOffersDraft?.savedServerOffers).toEqual(
        expect.arrayContaining(["building-t3", "subagents"]),
      );
      other.serverConfig.settings = {
        ...other.serverConfig.settings,
        featureOffersSeen: seenBeforeSave,
      };
      act(() => screen.root.render(null));
      act(() => screen.root.render(<FeatureOffersSheet active />));
    }
    await screen.click("Save");
    if (relaunch) {
      expect(mocks.update.mock.calls[1]?.[0].input.patch).toEqual({
        featureOffersSeen: expect.arrayContaining(["building-t3", "subagents"]),
      });
    } else {
      expect(mocks.update).toHaveBeenCalledOnce();
    }
    expect(other.serverConfig.settings.statusLineEnabled).toBe(false);
  },
);
