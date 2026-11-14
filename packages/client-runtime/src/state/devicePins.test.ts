import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, updateThreadPinMembership } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { createDevicePins, type DevicePinsState, type DevicePinsStorage } from "./devicePins.ts";
import { v2Project, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const ENV = EnvironmentId.make("first");
const OTHER_ENV = EnvironmentId.make("second");

function memoryStorage(): DevicePinsStorage {
  const documents = new Map<EnvironmentId, DevicePinsState>();
  return {
    load: async (id) => documents.get(id) ?? null,
    save: async (id, pins) => {
      documents.set(id, JSON.parse(JSON.stringify(pins)));
    },
  };
}

function client(
  storage: DevicePinsStorage,
  source: (id: EnvironmentId) => Atom.Atom<typeof v2ShellSnapshot>,
  deviceId: string,
) {
  const pins = createDevicePins(source, Atom.make(AsyncResult.success(deviceId)), storage);
  return { pins, snapshotAtom: pins.wrapSnapshot(source) };
}

describe("device pins", () => {
  it.effect(
    "persists independent project pins per client and environment without mutating shared records",
    () =>
      Effect.gen(function* () {
        const shared = {
          ...v2ShellSnapshot,
          projects: [{ ...v2Project, pinnedAt: "2026-11-11T01:00:00.000Z" }],
        };
        const source = Atom.family((_id: EnvironmentId) => Atom.make(shared));
        const phoneStore = memoryStorage();
        const desktopStore = memoryStorage();
        const phone = client(phoneStore, source, "phone");
        const desktop = client(desktopStore, source, "desktop");
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const setPin = (
          target: ReturnType<typeof client>,
          environmentId: EnvironmentId,
          pinned: boolean,
        ) =>
          Effect.promise(() =>
            target.pins.setProject.run(registry, {
              environmentId,
              projectId: v2Project.id,
              pinned,
            }),
          );
        expect((yield* setPin(phone, ENV, false))._tag).toBe("Success");
        expect((yield* setPin(desktop, ENV, true))._tag).toBe("Success");
        expect((yield* setPin(phone, OTHER_ENV, true))._tag).toBe("Success");
        expect(registry.get(phone.snapshotAtom(ENV))?.projects[0]?.pinnedAt).toBeNull();
        expect(registry.get(desktop.snapshotAtom(ENV))?.projects[0]?.pinnedAt).toBe(
          shared.projects[0]!.pinnedAt,
        );
        expect(registry.get(phone.snapshotAtom(OTHER_ENV))?.projects[0]?.pinnedAt).toBe(
          shared.projects[0]!.pinnedAt,
        );
        expect(registry.get(source(ENV))).toBe(shared);
        const reloaded = client(phoneStore, source, "phone");
        yield* AtomRegistry.toStream(registry, reloaded.pins.stateAtom(ENV)).pipe(
          Stream.filter((value) => value !== null),
          Stream.runHead,
        );
        expect(registry.get(reloaded.snapshotAtom(ENV))?.projects[0]?.pinnedAt).toBeNull();
      }),
  );

  it("displays only the current device's thread membership and honors a global settlement", () => {
    const now = DateTime.makeUnsafe("2026-11-12T00:00:00.000Z");
    const phonePin = updateThreadPinMembership({}, "pin", now, "phone", "a");
    const both = updateThreadPinMembership(phonePin, "pin", now, "desktop", "z");
    const source = Atom.family((_id: EnvironmentId) =>
      Atom.make({ ...v2ShellSnapshot, threads: [{ ...v2ThreadShell, ...both }] }),
    );
    const phone = client(memoryStorage(), source, "phone");
    const desktop = client(memoryStorage(), source, "desktop");
    const registry = AtomRegistry.make();
    const releasePhone = registry.mount(phone.snapshotAtom(ENV));
    const releaseDesktop = registry.mount(desktop.snapshotAtom(ENV));
    try {
      expect(registry.get(phone.snapshotAtom(ENV))?.threads[0]?.pinOrderKey).toBe("a");
      expect(registry.get(desktop.snapshotAtom(ENV))?.threads[0]?.pinOrderKey).toBe("z");
      registry.set(source(ENV), {
        ...v2ShellSnapshot,
        threads: [{ ...v2ThreadShell, ...updateThreadPinMembership(both, "unpin", now, "phone") }],
      });
      expect(registry.get(phone.snapshotAtom(ENV))?.threads[0]?.pinnedAt).toBeNull();
      expect(registry.get(desktop.snapshotAtom(ENV))?.threads[0]?.pinOrderKey).toBe("z");
      registry.set(source(ENV), {
        ...v2ShellSnapshot,
        threads: [
          {
            ...v2ThreadShell,
            ...both,
            devicePins: {},
            legacyPin: null,
            pinnedAt: null,
            pinOrderKey: null,
            settledOverride: "settled",
            settledAt: now,
          },
        ],
      });
      for (const target of [phone, desktop]) {
        expect(registry.get(target.snapshotAtom(ENV))?.threads[0]).toMatchObject({
          pinnedAt: null,
          settledOverride: "settled",
        });
      }
    } finally {
      releasePhone();
      releaseDesktop();
      registry.dispose();
    }
  });
});
