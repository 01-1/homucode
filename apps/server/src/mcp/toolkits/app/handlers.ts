import {
  OrchestratorMcpFailure,
  ServerRemoveKeybindingInput,
  ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as CheckpointDiffQuery from "../../../checkpointing/CheckpointDiffQuery.ts";
import * as Keybindings from "../../../keybindings.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as AgentSessionImporter from "../../../project/AgentSessionImporter.ts";
import * as AgentSessionScanner from "../../../project/AgentSessionScanner.ts";
import * as ScratchThreadPromotion from "../../../project/ScratchThreadPromotion.ts";
import * as WorktreeSetupTracker from "../../../project/WorktreeSetupTracker.ts";
import * as UsageService from "../../../usage/UsageService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread, unavailable } from "../../threadAccess.ts";
import { AppToolkit } from "./tools.ts";

export const DIFF_PAGE_CHARS = 40_000;
const decodeRemoveKeybinding = Schema.decodeUnknownEffect(ServerRemoveKeybindingInput);
const decodeUpsertKeybinding = Schema.decodeUnknownEffect(ServerUpsertKeybindingInput);

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const required = <A>(value: A | undefined, name: string) =>
  value === undefined
    ? Effect.fail(invalid(`This action needs \`${name}\`.`))
    : Effect.succeed(value);

/** One page of a long diff, so a large turn cannot flood the caller's context. */
const diffPage = (diff: string, offset: number) => {
  const end = offset + DIFF_PAGE_CHARS;
  return { diff: diff.slice(offset, end), nextOffset: end < diff.length ? end : null };
};

export const layer = McpToolAccess.toLayer(AppToolkit, {
  t3_session_import: McpToolAccess.either(
    (input) => input.action === "scan",
    McpToolAccess.reads(() =>
      Effect.gen(function* () {
        const scanner = yield* AgentSessionScanner.AgentSessionScanner;
        return yield* scanner.scan.pipe(Effect.mapError(unavailable));
      }),
    ),
    McpToolAccess.writes(
      (input) =>
        Effect.gen(function* () {
          const importer = yield* AgentSessionImporter.AgentSessionImporter;
          const projectId = yield* required(input.projectId, "projectId");
          if (input.action === "import") {
            return yield* importer
              .importRecentAgentThreads({
                projectId,
                ...(input.expectedWorkspaceRoot === undefined
                  ? {}
                  : { expectedWorkspaceRoot: input.expectedWorkspaceRoot }),
              })
              .pipe(Effect.mapError((error) => invalid(error.message)));
          }
          return yield* importer
            .importThreadTranscript({
              projectId,
              title: yield* required(input.title, "title"),
              modelSelection: yield* required(input.modelSelection, "modelSelection"),
              messages: yield* required(input.messages, "messages"),
            })
            .pipe(Effect.mapError((error) => invalid(error.message)));
        }),
      { refusal: "import threads into this environment" },
    ),
  ),
  t3_thread_diff: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId, ["checkpoints"]);
      const toTurnCount =
        input.toTurnCount ??
        Math.max(
          0,
          ...projection.checkpoints.flatMap((checkpoint) =>
            checkpoint.status === "ready" && checkpoint.appRunOrdinal != null
              ? [checkpoint.appRunOrdinal]
              : [],
          ),
        );
      const fromTurnCount = input.fromTurnCount ?? 0;
      if (fromTurnCount > toTurnCount) {
        return yield* invalid("`fromTurnCount` must not be after `toTurnCount`.");
      }
      const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      const common = {
        threadId: projection.thread.id,
        toTurnCount,
        ...(input.ignoreWhitespace === undefined
          ? {}
          : { ignoreWhitespace: input.ignoreWhitespace }),
      };
      const result = yield* (
        input.fromTurnCount === undefined
          ? query.getFullThreadDiff(common)
          : query.getTurnDiff({ ...common, fromTurnCount })
      ).pipe(Effect.mapError((error) => invalid(error.message)));
      return {
        threadId: result.threadId,
        fromTurnCount: result.fromTurnCount,
        toTurnCount: result.toTurnCount,
        ...diffPage(result.diff, input.offset ?? 0),
      };
    }),
  ),
  t3_keybinding: McpToolAccess.writesEnvironment(
    (input, check) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
        const keybindings = yield* Keybindings.Keybindings;
        const write = Effect.gen(function* () {
          // The turn may have ended, or the thread's modes changed, while this waited for the lock.
          yield* check;
          const decodeFailure = (error: { readonly message: string }) =>
            invalid(`Invalid keybinding: ${error.message}`);
          if (input.action === "remove") {
            const rule = yield* decodeRemoveKeybinding(
              yield* required(input.replace, "replace"),
            ).pipe(Effect.mapError(decodeFailure));
            return yield* keybindings
              .removeKeybindingRule(rule)
              .pipe(Effect.mapError((error) => invalid(error.message)));
          }
          const rule = yield* decodeUpsertKeybinding({
            key: yield* required(input.key, "key"),
            command: yield* required(input.command, "command"),
            ...(input.when === undefined ? {} : { when: input.when }),
            ...(input.replace === undefined ? {} : { replace: input.replace }),
          }).pipe(Effect.mapError(decodeFailure));
          return yield* keybindings
            .upsertKeybindingRule(rule)
            .pipe(Effect.mapError((error) => invalid(error.message)));
        });
        return yield* scope.thread === undefined
          ? write
          : executor.withLock(scope.thread.threadId, write);
      }),
    { approval: McpToolAccess.approvalPrompt("change a keyboard shortcut") },
  ),
  t3_usage_read: McpToolAccess.reads(({ environmentId: _, ...input }) =>
    Effect.gen(function* () {
      const usage = yield* UsageService.UsageService;
      return yield* usage
        .readSummary(input)
        .pipe(Effect.mapError((error) => invalid(error.message)));
    }),
  ),
  t3_project_from_thread: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const promotion = yield* ScratchThreadPromotion.ScratchThreadPromotion;
        return yield* promotion
          .promote({ threadId: projection.thread.id })
          .pipe(Effect.mapError((error) => invalid(error.message)));
      }),
  ),
  t3_worktree_setup_cancel: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const tracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
        return { cancelled: yield* tracker.cancel(projection.thread.id) };
      }),
  ),
});
