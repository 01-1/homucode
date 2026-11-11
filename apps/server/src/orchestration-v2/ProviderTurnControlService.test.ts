import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  ChatAttachmentId,
  MessageId,
  ScheduledTaskId,
  NodeId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ProviderTurnControlService from "./ProviderTurnControlService.ts";

const driver = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;

function makeProjection(input: {
  readonly now: DateTime.Utc;
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly providerTurnId: ProviderTurnId;
  readonly attemptId: RunAttemptId;
}): OrchestrationV2ThreadProjection {
  const runId = RunId.make("run:restart-session");
  const nodeId = NodeId.make("node:restart-session");
  return {
    thread: {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId: ProjectId.make("project:restart-session"),
      title: "Restart session",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: "/workspace",
      activeProviderThreadId: input.providerThread.id,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [],
    attempts: [
      {
        id: input.attemptId,
        runId,
        attemptOrdinal: 1,
        rootNodeId: nodeId,
        providerInstanceId,
        providerThreadId: input.providerThread.id,
        providerTurnId: input.providerTurnId,
        reason: "initial",
        status: "superseded",
        startedAt: input.now,
        completedAt: input.now,
      },
    ],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [input.providerThread],
    providerTurns: [
      {
        id: input.providerTurnId,
        providerThreadId: input.providerThread.id,
        nodeId,
        runAttemptId: input.attemptId,
        nativeTurnRef: {
          driver,
          nativeId: "native-turn:restart-session",
          strength: "strong",
        },
        ordinal: 1,
        status: "running",
        startedAt: input.now,
        completedAt: null,
      },
    ],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: input.now,
  };
}

it.effect(
  "interrupts the historical session only for the exact committed restart replacement",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:restart-session");
      const oldSessionId = ProviderSessionId.make("provider-session:restart-session:old");
      const replacementSessionId = ProviderSessionId.make(
        "provider-session:restart-session:replacement",
      );
      const unrelatedSessionId = ProviderSessionId.make(
        "provider-session:restart-session:unrelated",
      );
      const providerThreadId = ProviderThreadId.make("provider-thread:restart-session");
      const providerTurnId = ProviderTurnId.make("provider-turn:restart-session");
      const attemptId = RunAttemptId.make("run-attempt:restart-session");
      const providerThread: OrchestrationV2ProviderThread = {
        id: providerThreadId,
        driver,
        providerInstanceId,
        providerSessionId: replacementSessionId,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: {
          driver,
          nativeId: "native-thread:restart-session",
          strength: "strong",
        },
        nativeConversationHeadRef: null,
        status: "not_loaded",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      };
      const projection = yield* Ref.make(
        makeProjection({ now, threadId, providerThread, providerTurnId, attemptId }),
      );
      const interruptedThread = yield* Ref.make<OrchestrationV2ProviderThread | null>(null);
      const providerSession = {
        id: oldSessionId,
        driver,
        providerInstanceId,
        status: "running" as const,
        cwd: "/workspace",
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime = {
        instanceId: providerInstanceId,
        driver,
        providerSessionId: oldSessionId,
        providerSession,
        events: Stream.empty,
        ensureThread: () => Effect.die("unused ensureThread"),
        resumeThread: () => Effect.die("unused resumeThread"),
        startTurn: () => Effect.die("unused startTurn"),
        steerTurn: () => Effect.die("unused steerTurn"),
        interruptTurn: ({ providerThread: target }) =>
          Effect.all(
            [
              Ref.set(interruptedThread, target),
              Ref.update(projection, (current) => ({
                ...current,
                providerTurns: current.providerTurns.map((turn) =>
                  turn.id === providerTurnId
                    ? { ...turn, status: "interrupted" as const, completedAt: now }
                    : turn,
                ),
              })),
            ],
            { discard: true },
          ),
        respondToRuntimeRequest: () => Effect.die("unused respondToRuntimeRequest"),
        readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
        rollbackThread: () => Effect.die("unused rollbackThread"),
        forkThread: () => Effect.die("unused forkThread"),
      };
      const layerProjection = Layer.succeed(
        ProjectionStore.ProjectionStoreV2,
        ProjectionStore.ProjectionStoreV2.of({
          apply: () => Effect.void,
          getLimitRecoveryCandidates: () => Effect.die("unused getLimitRecoveryCandidates"),
          getLimitRecoveryWakeAt: () => Effect.die("unused getLimitRecoveryWakeAt"),
          getOpenRemoteDelegatedTasks: Effect.die("unused getOpenRemoteDelegatedTasks"),
          getAgentAwarenessSnapshot: () => Effect.die("unused awareness snapshot"),
          getShellSnapshot: () => Effect.die("unused getShellSnapshot"),
          listActiveSubagentThreadIds: () => Effect.die("unused listActiveSubagentThreadIds"),
          countThreads: () => Effect.die("unused countThreads"),
          listActiveShellIndex: () => Effect.die("unused listActiveShellIndex"),
          listOlderSettledThreads: () => Effect.die("unused listOlderSettledThreads"),
          readShellSnapshot: () => Effect.die("unused readShellSnapshot"),
          getThreadShell: () => Effect.die("unused getThreadShell"),
          getThreadTitles: () => Effect.die("unused getThreadTitles"),
          getThreadLinkMetadata: () => Effect.die("unused getThreadLinkMetadata"),
          findGuestShareThreadId: () => Effect.die("unused findGuestShareThreadId"),
          getThread: () => Ref.get(projection).pipe(Effect.map((state) => state.thread)),
          getSettlementCandidates: () => Effect.die("unused getSettlementCandidates"),
          getThreadsWithPullRequests: () => Effect.die("unused getThreadsWithPullRequests"),
          getThreadWorktreePaths: () => Effect.die("unused getThreadWorktreePaths"),
          getThreadProjection: () => Effect.die("control effects must not load transcript"),
          getTurnStartContext: () => Effect.die("unused"),
          getTurnStartHistory: () => Effect.die("unused"),
          getRuntimeRecoveryProjection: () => Effect.die("unused getRuntimeRecoveryProjection"),
          getPlan: () => Effect.die("unused"),
          hasUnpairedRunInterruptRequest: () => Effect.die("unused interrupt read"),
          getThreadAttachmentIds: () => Effect.die("Unused attachment lookup"),
          searchThread: () => Effect.die("unused"),
          searchThreadStream: () => Stream.empty,
          getThreadHistoryPage: () => Effect.die("unused"),
          getTimelinePage: () => Effect.die("Unused timeline read"),
          getMessageCount: () => Effect.die("unused message count"),
          getSubagentCount: () => Effect.die("unused subagent count"),
          listAppOwnedChildThreadIds: () => Effect.die("unused listAppOwnedChildThreadIds"),
          getNextTurnItemOrdinal: () => Effect.die("unused ordinal read"),
          getTurnItem: () => Effect.die("unused turn item read"),
          getMessagesById: () => Effect.die("unused getMessagesById"),
          getThreadRecords: () => Effect.die("unused record read"),
          getRuntimeRequest: () => Effect.die("unused getRuntimeRequest"),
          getRunningTurnContext: () => Effect.die("unused getRunningTurnContext"),
          getThreadProviderContext: () => Effect.die("unused getThreadProviderContext"),
          getRuntimeResponseContext: () => Effect.die("unused getRuntimeResponseContext"),
          getPendingNativeUserInputs: () => Effect.die("unused getPendingNativeUserInputs"),
          getProviderControlContext: (_threadId, target) =>
            Ref.get(projection).pipe(
              Effect.map((current) => ({
                providerThread: current.providerThreads.find(
                  (thread) => thread.id === target.providerThreadId,
                ),
                providerTurn: current.providerTurns.find(
                  (turn) => turn.id === target.providerTurnId,
                ),
                attempt: current.attempts.find((attempt) => attempt.id === target.attemptId),
                message: undefined,
                run: undefined,
              })),
            ),
          getCheckpointContext: () => Effect.die("not used"),
          getCheckpointRollbackContext: () => Effect.die("unused rollback context"),
          getCheckpointCaptureContext: () => Effect.die("not used"),
          getRunMessage: () => Effect.die("not used"),
          isNodeStored: () => Effect.die("not used"),
          canStartQueuedRun: () => Effect.die("not used"),
          getHeldQueuedRuns: () => Effect.die("not used"),
          getRecoveryThreadIds: () => Effect.die("unused getRecoveryThreadIds"),
          getUnreadableThreadIds: () => Effect.die("unused getUnreadableThreadIds"),
          getThreadSnapshot: () => Effect.die("unused getThreadSnapshot"),
          getThreadSnapshotWindow: () => Effect.die("unused getThreadSnapshotWindow"),
          getPullRequestSnapshot: () => Effect.die("unused getPullRequestSnapshot"),
        }),
      );
      const layerSessionManager = Layer.succeed(
        ProviderSessionManager.ProviderSessionManagerV2,
        ProviderSessionManager.ProviderSessionManagerV2.of({
          shutdown: Effect.void,
          open: () => Effect.die("unused open"),
          get: (providerSessionId) =>
            Effect.succeed(
              providerSessionId === oldSessionId ? Option.some(runtime) : Option.none(),
            ),
          isLive: (providerSessionId) => Effect.succeed(providerSessionId === oldSessionId),
          close: () => Effect.void,
          closeInstance: () => Effect.void,
          release: () => Effect.void,
          detach: () => Effect.void,
          otherWorkingThreads: () => Effect.succeed([]),
          releaseUnlessBusy: () => Effect.succeed(true),
          subscribePromptSuggestion: () => Stream.empty,
        }),
      );
      const layerControl = ProviderTurnControlService.layer.pipe(
        Layer.provide(Layer.merge(layerProjection, layerSessionManager)),
      );

      const [ordinaryInterrupt, unrelatedRestart] = yield* Effect.gen(function* () {
        const control = yield* ProviderTurnControlService.ProviderTurnControlServiceV2;
        const ordinary = yield* Effect.exit(
          control.interrupt({
            threadId,
            providerSessionId: oldSessionId,
            providerThreadId,
            providerTurnId,
          }),
        );
        const unrelated = yield* Effect.exit(
          control.interruptAndAwaitTerminal({
            threadId,
            providerSessionId: oldSessionId,
            replacementProviderSessionId: unrelatedSessionId,
            providerThreadId,
            providerTurnId,
            interruptedAttemptId: attemptId,
          }),
        );
        return [ordinary, unrelated] as const;
      }).pipe(Effect.provide(layerControl));

      assert.isTrue(Exit.isFailure(ordinaryInterrupt));
      assert.isTrue(Exit.isFailure(unrelatedRestart));
      assert.isNull(yield* Ref.get(interruptedThread));

      yield* Effect.gen(function* () {
        const control = yield* ProviderTurnControlService.ProviderTurnControlServiceV2;
        yield* control.interruptAndAwaitTerminal({
          threadId,
          providerSessionId: oldSessionId,
          replacementProviderSessionId: replacementSessionId,
          providerThreadId,
          providerTurnId,
          interruptedAttemptId: attemptId,
        });
      }).pipe(Effect.provide(layerControl));

      const interrupted = yield* Ref.get(interruptedThread);
      assert.isNotNull(interrupted);
      assert.equal(interrupted?.providerSessionId, oldSessionId);
      assert.equal(interrupted?.id, providerThreadId);
      assert.equal(interrupted?.nativeThreadRef?.nativeId, "native-thread:restart-session");
    }),
);

it.effect.each(["human", "agent", "scheduled", "coalesced", "slash"] as const)(
  "steers a %s message with its original send time only in provider text",
  (kind) =>
    Effect.gen(function* () {
      const now = DateTime.makeUnsafe("2026-11-11T12:00:00Z");
      const createdAt = DateTime.makeUnsafe("2026-11-10T22:49:34.987Z");
      const threadId = ThreadId.make("thread:timestamp");
      const runId = RunId.make("run:timestamp");
      const providerThreadId = ProviderThreadId.make("provider-thread:timestamp");
      const providerTurnId = ProviderTurnId.make("provider-turn:timestamp");
      const providerSessionId = ProviderSessionId.make("provider-session:timestamp");
      const attemptId = RunAttemptId.make("attempt:timestamp");
      const providerThread: OrchestrationV2ProviderThread = {
        id: providerThreadId,
        driver,
        providerInstanceId,
        providerSessionId,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "active",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      };
      const projection = makeProjection({
        now,
        threadId,
        providerThread,
        providerTurnId,
        attemptId,
      });
      const text =
        kind === "slash"
          ? "/skill task"
          : kind === "coalesced"
            ? "Reviewer A:\nfirst finding\n\nReviewer B:\nsecond finding"
            : "follow up";
      const message: OrchestrationV2ThreadProjection["messages"][number] = {
        id: MessageId.make("message:timestamp"),
        threadId,
        runId,
        nodeId: null,
        role: "user",
        text,
        attachments: [
          {
            id: ChatAttachmentId.make("attachment_timestamp"),
            type: "image",
            name: "image.png",
            mimeType: "image/png",
            sizeBytes: 42,
          },
        ],
        streaming: false,
        createdBy: kind === "human" || kind === "slash" ? "user" : "agent",
        creationSource: "server",
        createdAt,
        updatedAt: now,
        ...(kind === "agent" ? { senderThreadId: ThreadId.make("sender:timestamp") } : {}),
        ...(kind === "scheduled"
          ? { scheduledTaskId: ScheduledTaskId.make("schedule:timestamp") }
          : {}),
      };
      const run: OrchestrationV2ThreadProjection["runs"][number] = {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId,
        userMessageId: message.id,
        rootNodeId: null,
        activeAttemptId: attemptId,
        status: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      };
      const received: ProviderAdapter.ProviderAdapterV2SteerInput[] = [];
      const runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime = {
        instanceId: providerInstanceId,
        driver,
        providerSessionId,
        providerSession: {
          id: providerSessionId,
          driver,
          providerInstanceId,
          status: "running",
          cwd: "/workspace",
          model: modelSelection.model,
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        },
        events: Stream.empty,
        steerTurn: (input) =>
          Effect.sync(() => {
            received.push(input);
          }),
        ensureThread: () => Effect.die("unused"),
        resumeThread: () => Effect.die("unused"),
        startTurn: () => Effect.die("unused"),
        interruptTurn: () => Effect.die("unused"),
        respondToRuntimeRequest: () => Effect.die("unused"),
        readThreadSnapshot: () => Effect.die("unused"),
        rollbackThread: () => Effect.die("unused"),
        forkThread: () => Effect.die("unused"),
      };
      const layer = ProviderTurnControlService.layer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getProviderControlContext: () =>
                Effect.succeed({
                  providerThread,
                  providerTurn: { ...projection.providerTurns[0]!, status: "running" },
                  attempt: undefined,
                  message,
                  run,
                }),
            }),
            Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
              get: () => Effect.succeed(Option.some(runtime)),
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const control = yield* ProviderTurnControlService.ProviderTurnControlServiceV2;
        const target = {
          threadId,
          providerSessionId,
          providerThreadId,
          providerTurnId,
          messageId: message.id,
        };
        yield* control.steer(target);
        yield* control.steer(target);
      }).pipe(Effect.provide(layer));
      const sent = new Date(DateTime.toEpochMillis(createdAt));
      const timestamp = new Date(sent.getTime() - sent.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 19);
      assert.deepEqual(
        received.map((input) => input.message.text),
        [
          kind === "slash" ? text : `${timestamp}: ${text}`,
          kind === "slash" ? text : `${timestamp}: ${text}`,
        ],
      );
      assert.strictEqual(received[0]?.message.attachments, message.attachments);
      assert.equal(received[0]?.message.senderThreadId, message.senderThreadId);
      assert.equal(received[0]?.message.scheduledTaskId, message.scheduledTaskId);
      assert.equal(message.text, text);
    }),
);
