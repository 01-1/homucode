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

  it("preserves a legacy membership and device tombstones across serialization and shared unpin", () => {
    const legacy = { pinnedAt: NOW, pinOrderKey: "old" };
    const hiddenOnPhone = updateThreadPinMembership(legacy, "unpin", LATER, "phone");
    expect(threadPinForDevice(hiddenOnPhone, "phone")).toBeNull();
    expect(threadPinForDevice(hiddenOnPhone, "desktop")).toEqual({
      pinnedAt: DateTime.formatIso(NOW),
      orderKey: "old",
    });
    expect(hiddenOnPhone.pinnedAt).toEqual(NOW);
    const desktop = updateThreadPinMembership(hiddenOnPhone, "pin", LATER, "desktop");
    const sharedUnpin = updateThreadPinMembership(desktop, "unpin", LATER);
    expect(sharedUnpin.legacyPin).toBeNull();
    expect(sharedUnpin.pinnedAt).toEqual(NOW);
    expect(threadPinForDevice(sharedUnpin, "phone")).toBeNull();
    expect(threadPinForDevice(sharedUnpin, "new-device")).toBeNull();
    const roundtrip = Schema.decodeUnknownSync(DeviceThreadPins)(
      JSON.parse(JSON.stringify(sharedUnpin.devicePins)),
    );
    expect(roundtrip).toEqual(sharedUnpin.devicePins);
    expect(
      updateThreadPinMembership(
        { ...sharedUnpin, devicePins: roundtrip },
        "unpin",
        LATER,
        "desktop",
      ).pinnedAt,
    ).toBeNull();
  });
});
