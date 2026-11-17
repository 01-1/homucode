import { DesktopMadoHomuSettings, DesktopMadoHomuWindowMode } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopMadoHomu from "../../window/DesktopMadoHomu.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const configureMadoHomu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONFIGURE_MADOHOMU_CHANNEL,
  payload: DesktopMadoHomuSettings,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.madohomu.configure")(function* (settings) {
    yield* (yield* DesktopMadoHomu.DesktopMadoHomu).configure(settings);
  }),
});
export const setMadoHomuWindowMode = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MADOHOMU_WINDOW_MODE_CHANNEL,
  payload: DesktopMadoHomuWindowMode,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.madohomu.setWindowMode")(function* (mode) {
    yield* (yield* DesktopMadoHomu.DesktopMadoHomu).setWindowMode(mode);
  }),
});
