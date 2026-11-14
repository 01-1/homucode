import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  DeviceThreadPins,
  legacyThreadPin,
  threadPinForDevice,
  updateThreadPinMembership,
} from "./threadPins.ts";

const NOW = DateTime.makeUnsafe("2026-11-12T00:00:00.000Z");
const LATER = DateTime.makeUnsafe("2026-11-12T00:01:00.000Z");
const decodeDeviceThreadPins = Schema.decodeUnknownSync(DeviceThreadPins);

describe("device thread pins", () => {
  it("keeps two devices' membership and order independent while protecting their union", () => {
    const phone = updateThreadPinMembership({}, "pin", NOW, "phone", "a");
    expect(threadPinForDevice(phone, "desktop")).toBeNull();
    const both = updateThreadPinMembership(phone, "pin", LATER, "desktop", "z");
    const reordered = updateThreadPinMembership(both, "reorder", LATER, "phone", "b");
    expect(threadPinForDevice(reordered, "phone")).toEqual({
      pinnedAt: DateTime.formatIso(NOW),
      orderKey: "b",
    });
    expect(threadPinForDevice(reordered, "desktop")).toEqual({
      pinnedAt: DateTime.formatIso(LATER),
      orderKey: "z",
    });
    const desktopOnly = updateThreadPinMembership(reordered, "unpin", LATER, "phone");
    expect(threadPinForDevice(desktopOnly, "phone")).toBeNull();
    expect(desktopOnly.pinnedAt).toEqual(LATER);
    expect(desktopOnly.pinOrderKey).toBe("z");
    const neither = updateThreadPinMembership(desktopOnly, "unpin", LATER, "desktop");
    expect(neither.pinnedAt).toBeNull();
    expect(neither.pinOrderKey).toBeNull();
    expect(legacyThreadPin(neither)).toBeNull();
  });

  it("hides a legacy membership per device and lets shared commands reach every device", () => {
    const legacy = { pinnedAt: NOW, pinOrderKey: "old" };
    const oldPin = { pinnedAt: DateTime.formatIso(NOW), orderKey: "old" };
    const hiddenOnPhone = updateThreadPinMembership(legacy, "unpin", LATER, "phone");
    expect(hiddenOnPhone.devicePins.phone).toBeNull();
    expect(threadPinForDevice(hiddenOnPhone, "phone")).toBeNull();
    expect(threadPinForDevice(hiddenOnPhone, "desktop")).toEqual(oldPin);
    expect(hiddenOnPhone.pinnedAt).toEqual(NOW);
    const roundtrip = decodeDeviceThreadPins(JSON.parse(JSON.stringify(hiddenOnPhone.devicePins)));
    expect(roundtrip).toEqual(hiddenOnPhone.devicePins);
    // A pin with no device (an agent, the CLI or an older client) shows on every device again.
    const sharedPin = updateThreadPinMembership(
      { ...hiddenOnPhone, devicePins: roundtrip },
      "pin",
      LATER,
    );
    expect(threadPinForDevice(sharedPin, "phone")).toEqual(oldPin);
    expect(sharedPin.devicePins).toEqual({});
    // An unpin with no device removes every device's pin as well.
    const desktop = updateThreadPinMembership(hiddenOnPhone, "pin", LATER, "desktop", "d");
    expect(threadPinForDevice(desktop, "desktop")).toEqual(oldPin);
    const sharedUnpin = updateThreadPinMembership(desktop, "unpin", LATER);
    expect(sharedUnpin.legacyPin).toBeNull();
    expect(sharedUnpin.devicePins).toEqual({});
    expect(sharedUnpin.pinnedAt).toBeNull();
    expect(threadPinForDevice(sharedUnpin, "desktop")).toBeNull();
    expect(threadPinForDevice(sharedUnpin, "phone")).toBeNull();
  });

  it("leaves no marker after a device unpin with no shared pin, so a later shared pin shows everywhere", () => {
    const desktopOnly = updateThreadPinMembership({}, "pin", NOW, "desktop", "a");
    const unpinned = updateThreadPinMembership(desktopOnly, "unpin", LATER, "desktop");
    expect(unpinned.devicePins).toEqual({});
    expect(unpinned.pinnedAt).toBeNull();
    const agentPin = updateThreadPinMembership(unpinned, "pin", LATER);
    const shared = { pinnedAt: DateTime.formatIso(LATER), orderKey: null };
    expect(threadPinForDevice(agentPin, "desktop")).toEqual(shared);
    expect(threadPinForDevice(agentPin, "phone")).toEqual(shared);
    expect(agentPin.pinnedAt).toEqual(LATER);
  });
});
