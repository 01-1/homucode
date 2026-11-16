import {
  DesktopStagedBuildsStateSchema,
  DesktopStagedBuildUndoResultSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopStagedBuilds from "../../app/DesktopStagedBuilds.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getStagedBuildsState = makeIpcMethod({
  channel: IpcChannels.STAGED_BUILDS_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopStagedBuildsStateSchema),
  handler: Effect.fn("desktop.ipc.stagedBuilds.getState")(function* () {
    return yield* (yield* DesktopStagedBuilds.DesktopStagedBuilds).state;
  }),
});

export const undoStagedBuild = makeIpcMethod({
  channel: IpcChannels.STAGED_BUILDS_UNDO_CHANNEL,
  payload: Schema.Void,
  result: DesktopStagedBuildUndoResultSchema,
  handler: Effect.fn("desktop.ipc.stagedBuilds.undo")(function* () {
    return yield* (yield* DesktopStagedBuilds.DesktopStagedBuilds).undo;
  }),
});

export const redoStagedBuild = makeIpcMethod({
  channel: IpcChannels.STAGED_BUILDS_REDO_CHANNEL,
  payload: Schema.String,
  result: DesktopStagedBuildsStateSchema,
  handler: Effect.fn("desktop.ipc.stagedBuilds.redo")(function* (undoneAs) {
    return yield* (yield* DesktopStagedBuilds.DesktopStagedBuilds).redo(undoneAs);
  }),
});
