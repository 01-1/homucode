import {
  BackgroundActivityProfile,
  BackgroundActivityProfileSelection,
  ExecutionEnvironmentDescriptor,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** Settings an agent may change: no secrets, auth, spend, notifications, data deletion, or agent permissions. */
export const AGENT_SETTINGS = [
  "worktreesDirectory",
  "fastWorktreeCheckout",
  "worktreeSubmodules",
  "newLocalThreadsUseDefaultBranch",
  "addProjectBaseDirectory",
  "ghqCloneLayout",
  "defaultAutoPull",
  "projectAutoPullOverrides",
  "defaultProjectScripts",
  "projectScriptOverrides",
  "automaticGitFetchInterval",
  "providerHealthRefreshInterval",
  "responseStreamingMode",
  "continueThreadsAfterServerUpdate",
  "keepAwakeWhileAgentsWork",
  "defaultModelSelection",
  "fallbackModelSelection",
  "quickModelSelection",
  "textGenerationModelSelection",
  "sidebarAutoSettleAfterDays",
  "sidebarAutoSettleKeepPullRequests",
  "sidebarAutoSettleOnMerge",
  "compactIdleThreads",
  "idleCompaction",
  "idleCompactionFallback",
  "autoResumeLimitedThreads",
  "snoozeLimitedThreads",
  "snoozePresets",
  "hiddenThreadTags",
  "hideTaggedThreads",
  "bareStopWaitEnabled",
  "claudeSteersSurviveStop",
  "claudeHoldBackgroundCommands",
  "applyModelChangeNow",
  "messageSentFromEnabled",
  "stopThreadSubagents",
  "preferNativeSubagents",
  "promptSuggestionsEnabled",
  "threadTitleInstructions",
  "threadTitleIncludeProjectName",
  "threadTitleIdPrefix",
  "branchNamingMode",
  "branchNamePrefix",
  "branchNameInstructions",
  "removeAgentCreditsOnMerge",
  "sourceControlWriterModelSelection",
  "reviewGuidesEnabled",
  "reviewGuideModelSelection",
  "reviewGuideInstructions",
  "pullRequestMergeMethod",
  "environmentIcon",
] as const satisfies ReadonlyArray<keyof typeof ServerSettingsPatch.fields>;
type AgentSetting = (typeof AGENT_SETTINGS)[number];
const pick = <F extends Record<AgentSetting, Schema.Top>>(fields: F) =>
  Object.fromEntries(AGENT_SETTINGS.map((key) => [key, fields[key]])) as Pick<F, AgentSetting>;

const PreferenceFields = {
  ...pick(ServerSettings.fields),
  defaultThreadEnvMode: ServerSettings.fields.defaultThreadEnvMode,
  newWorktreesStartFromOrigin: ServerSettings.fields.newWorktreesStartFromOrigin,
  enableProviderUpdateChecks: ServerSettings.fields.enableProviderUpdateChecks,
  backgroundActivity: Schema.Struct({ profile: BackgroundActivityProfileSelection }),
  sourceControlWritingStyle: Schema.Struct({
    mode: Schema.String,
    followChangeRequestTemplates: Schema.Boolean,
    customInstructions: Schema.String,
    truncated: Schema.Boolean,
  }),
};
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    Settings.ServerSettingsService,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
};
const EnvironmentReadTool = Tool.make("t3_environment_read", {
  ...shared,
  description:
    "Read this server's identity and preferences. Providers and models: `orchestrator_capabilities`.",
  parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
  success: Schema.Struct({
    environmentId: ExecutionEnvironmentDescriptor.fields.environmentId,
    label: Schema.String,
    serverVersion: Schema.String,
    platform: ExecutionEnvironmentDescriptor.fields.platform,
    preferences: Schema.Struct(PreferenceFields),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const EnvironmentPreferencesTool = Tool.make("t3_environment_preferences_update", {
  ...shared,
  description:
    "Update environment-wide preferences. Asks the user first below full access. Omitted fields are unchanged; `customInstructions: ''` clears it.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    defaultThreadEnvMode: ServerSettingsPatch.fields.defaultThreadEnvMode,
    newWorktreesStartFromOrigin: ServerSettingsPatch.fields.newWorktreesStartFromOrigin,
    enableProviderUpdateChecks: ServerSettingsPatch.fields.enableProviderUpdateChecks,
    backgroundActivity: Schema.optionalKey(Schema.Struct({ profile: BackgroundActivityProfile })),
    sourceControlWritingStyle: ServerSettingsPatch.fields.sourceControlWritingStyle,
    ...pick(ServerSettingsPatch.fields),
  }),
  success: Schema.Struct(PreferenceFields),
}).annotate(Tool.Destructive, true);
export const EnvironmentToolkit = Toolkit.make(EnvironmentReadTool, EnvironmentPreferencesTool);
