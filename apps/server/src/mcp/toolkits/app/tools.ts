import {
  AgentSessionImportInput,
  AgentSessionImportResult,
  AgentSessionScanResult,
  NonNegativeInt,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProjectId,
  ServerUpsertKeybindingResult,
  ThreadId,
  ThreadTranscriptImportInput,
  ThreadTranscriptImportResult,
  UsageSummary,
  UsageSummaryInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as CheckpointDiffQuery from "../../../checkpointing/CheckpointDiffQuery.ts";
import * as Keybindings from "../../../keybindings.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as AgentSessionImporter from "../../../project/AgentSessionImporter.ts";
import * as AgentSessionScanner from "../../../project/AgentSessionScanner.ts";
import * as ScratchThreadPromotion from "../../../project/ScratchThreadPromotion.ts";
import * as WorktreeSetupTracker from "../../../project/WorktreeSetupTracker.ts";
import * as UsageService from "../../../usage/UsageService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
};
const threadDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
];

const SessionImportTool = Tool.make("t3_session_import", {
  ...shared,
  description:
    "Import Claude Code and Codex sessions from this machine into T3 Code threads. scan: list importable projects. import: import a project's recent sessions by `projectId`. transcript: create a thread in `projectId` from `title`, `modelSelection`, and `messages`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    action: Schema.Literals(["scan", "import", "transcript"]),
    projectId: Schema.optional(ProjectId),
    expectedWorkspaceRoot: AgentSessionImportInput.fields.expectedWorkspaceRoot,
    title: Schema.optional(ThreadTranscriptImportInput.fields.title),
    modelSelection: Schema.optional(ThreadTranscriptImportInput.fields.modelSelection),
    messages: Schema.optional(ThreadTranscriptImportInput.fields.messages),
  }),
  success: Schema.Union([
    AgentSessionScanResult,
    AgentSessionImportResult,
    ThreadTranscriptImportResult,
  ]),
  dependencies: [
    ...threadDependencies,
    AgentSessionScanner.AgentSessionScanner,
    AgentSessionImporter.AgentSessionImporter,
  ],
}).annotate(Tool.Destructive, false);

const ThreadDiffTool = Tool.make("t3_thread_diff", {
  ...shared,
  description:
    "Read a thread's checkpoint diff, as its Diff panel shows. Omit `threadId` for this thread. No `fromTurnCount`: everything up to `toTurnCount` (default: newest turn). Long diffs page by `offset`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
    fromTurnCount: Schema.optional(NonNegativeInt),
    toTurnCount: Schema.optional(NonNegativeInt),
    ignoreWhitespace: Schema.optional(Schema.Boolean),
    offset: Schema.optional(NonNegativeInt),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    fromTurnCount: NonNegativeInt,
    toTurnCount: NonNegativeInt,
    diff: Schema.String,
    nextOffset: Schema.NullOr(NonNegativeInt),
  }),
  dependencies: [...threadDependencies, CheckpointDiffQuery.CheckpointDiffQuery],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const KeybindingTool = Tool.make("t3_keybinding", {
  ...shared,
  description:
    "Add, change, or remove a T3 Code keyboard shortcut, only when the user asks. upsert: bind `key` (such as `mod+shift+k`) to a T3 `command` id; an unknown id returns the valid ones. Optional `when` clause; `replace` names the rule it replaces. remove: drop the rule `replace` names. Asks the user first below full access.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    action: Schema.Literals(["upsert", "remove"]),
    key: Schema.optional(Schema.String),
    command: Schema.optional(Schema.String),
    when: Schema.optional(Schema.String),
    replace: Schema.optional(
      Schema.Struct({
        key: Schema.String,
        command: Schema.String,
        when: Schema.optional(Schema.String),
      }),
    ),
  }),
  success: ServerUpsertKeybindingResult,
  dependencies: [
    ...threadDependencies,
    Keybindings.Keybindings,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
}).annotate(Tool.Destructive, true);

const UsageReadTool = Tool.make("t3_usage_read", {
  ...shared,
  description:
    "Read provider token usage and cost between `sinceDay` and `untilDay` (YYYY-MM-DD) in IANA `timeZone`, as Settings > Usage shows.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    ...UsageSummaryInput.fields,
  }),
  success: UsageSummary,
  dependencies: [...threadDependencies, UsageService.UsageService],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ProjectFromThreadTool = Tool.make("t3_project_from_thread", {
  ...shared,
  description:
    "Turn a scratch thread's folder into a named project, as its Create project button does. Omit `threadId` for this thread.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({ projectId: ProjectId }),
  dependencies: [...threadDependencies, ScratchThreadPromotion.ScratchThreadPromotion],
}).annotate(Tool.Destructive, false);

const WorktreeSetupCancelTool = Tool.make("t3_worktree_setup_cancel", {
  ...shared,
  description:
    "Stop a thread's running worktree setup script. Omit `threadId` for this thread. `t3_thread_organize` `retry_setup` runs it again.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({ cancelled: Schema.Boolean }),
  dependencies: [...threadDependencies, WorktreeSetupTracker.WorktreeSetupTracker],
}).annotate(Tool.Destructive, true);

export const AppToolkit = Toolkit.make(
  SessionImportTool,
  ThreadDiffTool,
  KeybindingTool,
  UsageReadTool,
  ProjectFromThreadTool,
  WorktreeSetupCancelTool,
);
