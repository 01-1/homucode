import {
  isCompactionCommandMessage,
  type ModelSelection,
  type OrchestrationV2ModelSwitch,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import { runRanAfter } from "@t3tools/shared/orchestrationV2ThreadError";

export function modelSwitchBetween(
  from: ModelSelection | undefined,
  to: ModelSelection,
): OrchestrationV2ModelSwitch | undefined {
  return from === undefined || modelSelectionsEqual(from, to) ? undefined : { from, to };
}

/** Live changes belong to the attempt that accepted them. A replacement starts on its own selection. */
export function modelSelectionAtRun(
  run: OrchestrationV2Run,
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): ModelSelection {
  const live = turnItems.findLast(
    (item) =>
      item.type === "system_notice" &&
      item.modelSwitch !== undefined &&
      item.runId === run.id &&
      item.nodeId === run.rootNodeId,
  );
  return live?.type === "system_notice"
    ? (live.modelSwitch?.to ?? run.modelSelection)
    : run.modelSelection;
}

/**
 * The model or effort change a new run brings, measured from the latest run the timeline shows
 * through its message or its handoff row, so consecutive dividers always chain. `baseline` stands
 * in when there is none, such as a fork's source run. Callers skip starts with a context handoff;
 * the handoff item already shows those.
 */
export function modelSwitchSince(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "turnItems">,
  to: ModelSelection,
  baseline?: ModelSelection,
): Pick<Extract<OrchestrationV2TurnItem, { type: "user_message" }>, "modelSwitch"> {
  // Clients hide pending queued messages, fold async answers into their question, and replace
  // `/compact` with a compaction row.
  const shown = new Set(
    projection.turnItems.flatMap((item) =>
      item.type === "user_message" &&
      !(item.inputIntent === "queued_turn" && item.status === "pending") &&
      !item.messageId.startsWith("async-answer:") &&
      !isCompactionCommandMessage({ role: "user", ...item })
        ? [item.messageId]
        : [],
    ),
  );
  const markedRuns = new Set(
    projection.turnItems.flatMap((item) =>
      (item.type === "notification" || item.type === "system_notice") && item.modelSwitch
        ? [item.runId]
        : [],
    ),
  );
  let previous: OrchestrationV2Run | undefined;
  for (const run of projection.runs) {
    if (run.status === "rolled_back" || run.status === "queued") continue;
    // A wake can show its selection through a switch or handoff even when it has no user bubble.
    if (!shown.has(run.userMessageId) && run.contextHandoffId === null && !markedRuns.has(run.id))
      continue;
    if (previous === undefined || runRanAfter(run, previous)) previous = run;
  }
  const modelSwitch = modelSwitchBetween(
    previous === undefined ? baseline : modelSelectionAtRun(previous, projection.turnItems),
    to,
  );
  return modelSwitch === undefined ? {} : { modelSwitch };
}
