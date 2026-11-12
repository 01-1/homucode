import { createDevicePins, createDeviceIdentityAtom } from "@t3tools/client-runtime/state/device-pins";
import * as Effect from "effect/Effect";

import * as Runtime from "../lib/runtime";
import { MobilePreferencesStore } from "../persistence/mobile-preferences";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

export const devicePins = createDevicePins(environmentSnapshotAtom, createDeviceIdentityAtom(connectionAtomRuntime), {
  load: (environmentId) => Runtime.runtime.runPromise(
    MobilePreferencesStore.pipe(Effect.flatMap((store) => store.load), Effect.map((preferences) => preferences.devicePins?.[environmentId] ?? null)),
  ),
  save: (environmentId, pins) => Runtime.runtime.runPromise(
    MobilePreferencesStore.pipe(Effect.flatMap((store) => store.update((current) => ({ devicePins: { ...current.devicePins, [environmentId]: pins } }))), Effect.asVoid),
  ),
});
