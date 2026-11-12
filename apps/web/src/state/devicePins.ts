import { createDevicePins, createDeviceIdentityAtom } from "@t3tools/client-runtime/state/device-pins";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

const KEY_PREFIX = "t3code:device-pins:v1:";

export const devicePins = createDevicePins(environmentSnapshotAtom, createDeviceIdentityAtom(connectionAtomRuntime), {
  load: async (environmentId) => {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${environmentId}`);
    return raw === null ? null : JSON.parse(raw);
  },
  save: async (environmentId, pins) => {
    window.localStorage.setItem(`${KEY_PREFIX}${environmentId}`, JSON.stringify(pins));
  },
});
