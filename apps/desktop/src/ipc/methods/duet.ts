import { DesktopDuetSettings, DesktopDuetWindowMode } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopDuet from "../../window/DesktopDuet.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const configureDuet = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONFIGURE_DUET_CHANNEL,
  payload: DesktopDuetSettings,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.duet.configure")(function* (settings) {
    yield* (yield* DesktopDuet.DesktopDuet).configure(settings);
  }),
});
export const setDuetWindowMode = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DUET_WINDOW_MODE_CHANNEL,
  payload: DesktopDuetWindowMode,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.duet.setWindowMode")(function* (mode) {
    yield* (yield* DesktopDuet.DesktopDuet).setWindowMode(mode);
  }),
});
