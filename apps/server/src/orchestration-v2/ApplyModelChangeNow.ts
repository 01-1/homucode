import {
  CommandId,
  MessageId,
  type ModelSelection,
  type ProviderSessionId,
  type ProviderThreadId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ProviderTurnControlService from "./ProviderTurnControlService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

function selectionLabel(selection: ModelSelection): string {
  const options = (selection.options ?? []).map((option) => `${option.id} ${String(option.value)}`);
  return options.length === 0 ? selection.model : `${selection.model} (${options.join(", ")})`;
}

function selectionRestartPrompt(selection: ModelSelection): string {
  return `Your model or effort changed to ${selectionLabel(selection)}, so your last turn was stopped and restarted on it. Continue the task you were working on. A command or other action you started may have finished or may still be running: before you repeat one that changes state, confirm it did not take effect and is not still running.`;
}

/** Applies the selection to the running turn where the provider can, and otherwise restarts the turn on it. */
export const applyModelSelectionNow = Effect.fn("ApplyModelChangeNow.applyModelSelectionNow")(
  function* (input: {
    readonly effectId: string;
    readonly threadId: ThreadId;
    readonly restartRunId?: RunId;
    readonly providerSessionId: ProviderSessionId;
    readonly providerThreadId: ProviderThreadId;
    readonly modelSelection: ModelSelection;
  }) {
    const turnControl = yield* ProviderTurnControlService.ProviderTurnControlServiceV2;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const apply = turnControl.applyModelSelection({
      threadId: input.threadId,
      ...(input.restartRunId === undefined ? {} : { expectedRunId: input.restartRunId }),
      providerSessionId: input.providerSessionId,
      providerThreadId: input.providerThreadId,
      modelSelection: input.modelSelection,
    });
    // A replacement message must see a live change that the old attempt has just accepted.
    const appliedLive = yield* threads.withMessageIntake(
      input.threadId,
      (input.restartRunId === undefined
        ? apply
        : apply.pipe(
            Effect.catch((cause) =>
              Effect.logWarning("orchestration-v2.live-selection-failed", { cause }).pipe(
                Effect.as(undefined),
              ),
            ),
          )
      ).pipe(
        Effect.tap((applied) =>
          applied === undefined
            ? Effect.void
            : threads.dispatch({
                type: "run.live-model-selection.record",
                commandId: CommandId.make(`command:live-model-selection:${input.effectId}`),
                threadId: input.threadId,
                ...applied,
                modelSelection: input.modelSelection,
              }),
        ),
      ),
    );
    if (appliedLive !== undefined) return;
    if (input.restartRunId === undefined) return;
    const text = selectionRestartPrompt(input.modelSelection);
    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`command:selection-restart:${input.effectId}`),
      threadId: input.threadId,
      messageId: MessageId.make(`message:selection-restart:${input.effectId}`),
      text,
      notification: {
        source: { kind: "system" },
        outcome: "updated",
        summary: `Restarted on ${selectionLabel(input.modelSelection)}`,
        detail: text,
      },
      attachments: [],
      modelSelection: input.modelSelection,
      selectionRestartOfRunId: input.restartRunId,
      dispatchMode: { type: "restart_active", targetRunId: input.restartRunId },
      createdBy: "agent",
      creationSource: "server",
    });
  },
);
