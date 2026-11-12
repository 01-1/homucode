import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ThreadPin = Schema.Struct({
  pinnedAt: IsoDateTime,
  orderKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type ThreadPin = typeof ThreadPin.Type;
export const DeviceThreadPins = Schema.Record(Schema.String, Schema.NullOr(ThreadPin));

interface ThreadPins {
  readonly pinnedAt?: DateTime.Utc | null;
  readonly pinOrderKey?: string | null;
  readonly legacyPin?: ThreadPin | null;
  readonly devicePins?: typeof DeviceThreadPins.Type;
}

export function legacyThreadPin(thread: ThreadPins): ThreadPin | null {
  return thread.legacyPin !== undefined
    ? thread.legacyPin
    : thread.pinnedAt == null
      ? null
      : {
          pinnedAt: DateTime.formatIso(thread.pinnedAt),
          orderKey: thread.pinOrderKey ?? null,
        };
}

export function threadPinForDevice(thread: ThreadPins, deviceId: string): ThreadPin | null {
  return thread.devicePins?.[deviceId] !== undefined
    ? thread.devicePins[deviceId]!
    : legacyThreadPin(thread);
}

export function updateThreadPinMembership(
  thread: ThreadPins,
  action: "pin" | "unpin" | "reorder",
  now: DateTime.Utc,
  deviceId?: string,
  orderKey?: string,
) {
  // Preserve old shared pins as a separate membership; aggregate fields keep server lifecycle checks unchanged.
  let legacyPin = legacyThreadPin(thread);
  const devicePins = { ...thread.devicePins };
  const current = deviceId === undefined ? legacyPin : threadPinForDevice(thread, deviceId);
  const next =
    action === "unpin"
      ? null
      : action === "reorder"
        ? current === null
          ? null
          : { ...current, orderKey: orderKey ?? current.orderKey }
        : (current ?? { pinnedAt: DateTime.formatIso(now), orderKey: orderKey ?? null });
  if (deviceId === undefined) legacyPin = next;
  else devicePins[deviceId] = next;
  const aggregate = legacyPin ?? Object.values(devicePins).find((pin) => pin !== null) ?? null;
  return {
    legacyPin,
    devicePins,
    pinnedAt: aggregate === null ? null : DateTime.makeUnsafe(aggregate.pinnedAt),
    pinOrderKey: aggregate?.orderKey ?? null,
  };
}
