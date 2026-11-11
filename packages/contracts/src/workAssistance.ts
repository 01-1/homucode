import * as Schema from "effect/Schema";
import { IsoDateTime, NodeId, ProjectId, RunId, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ProviderOptionSelections } from "./model.ts";

export const WorkAssistanceReason = Schema.Literals([
  "archived",
  "settled",
  "excluded",
  "automation_helper",
  "not_running",
  "pending_request",
  "thread_wait",
  "stopping",
  "quota",
  "unknown_continuity",
  "under_threshold",
]);
export const ThreadActivityInput = Schema.Struct({ projectId: ProjectId });
export const ThreadActivityItem = Schema.Struct({
  threadId: ThreadId,
  parentThreadId: Schema.NullOr(ThreadId),
  relationshipToParent: Schema.NullOr(Schema.Literals(["fork", "subagent"])),
  activeRunId: Schema.NullOr(RunId),
  status: Schema.String,
  providerInstanceId: ProviderInstanceId,
  continuousWorkingSince: Schema.NullOr(IsoDateTime),
  eligible: Schema.Boolean,
  reason: Schema.NullOr(WorkAssistanceReason),
  automationHelper: Schema.Boolean,
  settled: Schema.Boolean,
  archived: Schema.Boolean,
  blockedOnThreadWait: Schema.Boolean,
  pendingRequestCount: Schema.Number,
});
export type ThreadActivityItem = typeof ThreadActivityItem.Type;
export const ThreadActivityResult = Schema.Struct({
  environmentId: Schema.String,
  projectId: ProjectId,
  observedAt: IsoDateTime,
  threads: Schema.Array(ThreadActivityItem),
});
export type ThreadActivityResult = typeof ThreadActivityResult.Type;
export const ThreadAssistInput = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  runId: RunId,
  origin: Schema.Literal("pace-v1"),
  providerInstanceId: ProviderInstanceId,
  model: Schema.String,
  options: ProviderOptionSelections,
});
export type ThreadAssistInput = typeof ThreadAssistInput.Type;
export const ThreadAssistResult = Schema.Struct({
  taskId: NodeId,
  childThreadId: ThreadId,
  childRunId: RunId,
  replayed: Schema.Boolean,
});
export type ThreadAssistResult = typeof ThreadAssistResult.Type;
