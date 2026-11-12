import {
  CommandId,
  isOrchestrationV2WorkActive,
  type OrchestrationV2Autoreviewer,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as Orchestrator from "./Orchestrator.ts";
import type { ThreadManagementProviderInstanceDisabledError, ThreadManagementServiceShape } from "./ThreadManagementService.ts";

export class AutoreviewerStopError extends Schema.TaggedError<AutoreviewerStopError>()(
  "AutoreviewerStopError",
  { message: Schema.String },
) {}

export type StopAutoreviewerWorkError =
  | AutoreviewerStopError
  | Orchestrator.OrchestratorV2Error
  | ThreadManagementProviderInstanceDisabledError;

type Port = Pick<ThreadManagementServiceShape, "dispatch" | "getThreadRecords">;

/** Uses the same host commands as task cancellation; never interrupts the reviewed parent. */
export const stopAutoreviewerWork = Effect.fn("AutoreviewService.stopWork")(function* (
  threads: Port,
  input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly reviewer: OrchestrationV2Autoreviewer;
  },
) {
  const parent = yield* threads.getThreadRecords(input.threadId, ["subagents"]);
  const selected = parent.subagents.find((task) => task.id === input.reviewer.taskId);
  if (selected?.origin !== "app_owned" || selected.childThreadId !== input.reviewer.threadId) {
    return yield* new AutoreviewerStopError({ message: "The attached reviewer no longer matches its delegated task." });
  }
  // Human follow-ups create separate parent tasks for the same reviewer thread. Dispose
  // every such delivery before Stop can publish a terminal and trigger async settlement.
  for (const task of parent.subagents) {
    if (task.origin !== "app_owned" || task.childThreadId !== input.reviewer.threadId ||
      task.completionDelivery?.state === "disposed") continue;
    yield* threads.dispatch({
      type: "delegated_task.completion-delivery.dispose",
      commandId: CommandId.make(`${input.commandId}:${task.id}:dispose`),
      parentThreadId: input.threadId,
      taskId: task.id,
    });
  }
  const visited = new Set<ThreadId>();
  const cancelTask = Effect.fn("AutoreviewService.cancelTask")(function* (
    parentThreadId: ThreadId,
    task: OrchestrationV2Subagent,
    reviewer: boolean,
  ): Effect.fn.Return<void, StopAutoreviewerWorkError> {
    const commandId = (suffix: string) => CommandId.make(`${input.commandId}:${task.id}:${suffix}`);
    // Suppress task-result wakes as well as the autoreview reactor's findings lane.
    if (task.completionDelivery?.state !== "disposed") {
      yield* threads.dispatch({
        type: "delegated_task.completion-delivery.dispose",
        commandId: commandId("dispose"), parentThreadId, taskId: task.id,
      });
    }
    if (task.childThreadId === null) {
      if (task.remoteChild !== undefined) {
        yield* threads.dispatch(task.result === null ? {
          type: "delegated_task.remote.complete",
          commandId: commandId("remote"), parentThreadId, taskId: task.id,
          status: "interrupted", result: "Stopped with its autoreviewer by the user.",
        } : {
          type: "delegated_task.remote.stop",
          commandId: commandId("remote"), parentThreadId, taskId: task.id,
        });
      }
      return;
    }
    const childThreadId = task.childThreadId;
    const firstVisit = !visited.has(childThreadId);
    if (firstVisit) {
      visited.add(childThreadId);
      yield* threads.dispatch({
        type: "thread.stop", commandId: commandId("stop"), threadId: childThreadId,
        stopDelegatedTasks: false, reason: "Autoreviewer stopped by the user.",
      });
    }
    const child = yield* threads.getThreadRecords(childThreadId, ["runs", "subagents"]);
    // The selected reviewer stops as a whole. Descendant queues stay scoped to their task.
    for (const run of child.runs) {
      if (run.status !== "queued" || (!reviewer && run.delegatedTaskId !== task.id)) continue;
      yield* threads.dispatch({
        type: "queued-run.cancel",
        commandId: commandId(`queue:${run.id}`),
        threadId: childThreadId,
        runId: run.id,
      });
    }
    // Match Stop-with-subagents: independently attached reviewers are not ordinary delegates.
    const independentReviewers = new Set(
      (child.thread.autoreviewers ?? []).map((entry) => entry.taskId),
    );
    if (firstVisit) {
      for (const delegated of child.subagents) {
        if (delegated.origin === "app_owned" && !independentReviewers.has(delegated.id)) {
          yield* cancelTask(childThreadId, delegated, false);
        }
      }
    }
    // Also settle a follow-up whose original child run is already terminal or missing.
    const latest = yield* threads.getThreadRecords(parentThreadId, ["subagents"], { subagentIds: [task.id] });
    const remaining = latest.subagents.find((entry) => entry.id === task.id);
    if (remaining?.runId != null && isOrchestrationV2WorkActive(remaining.status)) {
      yield* threads.dispatch({
        type: "subagent.stop", commandId: commandId("orphan"),
        threadId: parentThreadId, runId: remaining.runId, subagentId: task.id,
      });
    }
  });
  yield* cancelTask(input.threadId, selected, true);
});
