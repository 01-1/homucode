import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import {
  CheckpointId,
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as TestClock from "effect/testing/TestClock";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import { continueRestartedRun } from "./RestartContinuation.ts";
import * as RuntimeLayer from "./runtimeLayer.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";
import * as ProviderTurnStartServiceTestkit from "./ProviderTurnStartService.testkit.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderContinuationService from "./ProviderContinuationService.ts";

const layerPlatformTest = Layer.merge(
  Layer.mergeAll(NodeServices.layer, NodeCrypto.layer),
  Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    resolveLink: () => Effect.die("unused title link"),
  }),
);

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-orchestration-v2-delegated-completion-",
});

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;

const layerVcsDriverRegistryTest = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(layerServerConfig),
  Layer.provide(layerPlatformTest),
);

const layerCheckpointStoreTest = CheckpointStore.layer.pipe(
  Layer.provide(layerVcsDriverRegistryTest),
);

const driver = ProviderDriverKind.make("codex");
const orchestrationAdapter = {
  instanceId: modelSelection.instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("sessions are not used by delegated completion tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const providerInstance = {
  instanceId: modelSelection.instanceId,
  driverKind: driver,
  continuationIdentity: {
    driverKind: driver,
    continuationKey: "codex:test",
  },
  displayName: "Codex test",
  enabled: true,
  snapshot: { getSnapshot: Effect.succeed({}) } as unknown as ProviderInstance["snapshot"],
  orchestrationAdapter,
  textGeneration: {} as ProviderInstance["textGeneration"],
} satisfies ProviderInstance;

const layerTestProviderInstanceRegistry = Layer.succeed(
  ProviderInstanceRegistry.ProviderInstanceRegistry,
  {
    getInstance: (instanceId) =>
      Effect.succeed(instanceId === providerInstance.instanceId ? providerInstance : undefined),
    listInstances: Effect.succeed([providerInstance]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.never,
  },
);

const layerTest = Layer.mergeAll(
  RuntimeLayer.layer,
  RuntimeLayer.layerEventSink,
  ThreadCommandExecutor.layer,
).pipe(
  Layer.provideMerge(RuntimeLayer.layerProjectService),
  Layer.provide(
    Layer.mock(WorkspacePaths.WorkspacePaths)({
      normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
    }),
  ),
  Layer.provide(ProviderTurnStartServiceTestkit.layer),
  Layer.provide(
    Layer.succeed(ProjectEnrichmentService.ProjectEnrichmentService, {
      peek: () =>
        Effect.succeed({
          repositoryIdentity: null,
          faviconPath: null,
          repositoryIdentityResolved: false,
        }),
      request: () => Effect.void,
      readRepositoryIdentity: () => Effect.succeed(null),
      getAvailable: () =>
        Effect.succeed({
          repositoryIdentity: null,
          faviconPath: null,
          repositoryIdentityResolved: false,
        }),
      invalidate: () => Effect.void,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(McpSessionRegistryTestkit.layer),
  Layer.provide(McpProviderSessions.layer),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(layerCheckpointStoreTest),
  Layer.provide(layerServerConfig),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(layerTestProviderInstanceRegistry),
  Layer.provide(layerPlatformTest),
);

// ProviderContinuationService consumes the orchestrator's continuation queue, as in production.
const layerContinuationWorkerTest = ProviderContinuationService.layer.pipe(
  Layer.provide(Layer.merge(ProviderContinuationRequests.layer, IdAllocator.layer)),
  Layer.provideMerge(layerTest),
);

const seedParentWithTerminalTask = (input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly runId: RunId;
  readonly rootNodeId: NodeId;
  readonly taskId: NodeId;
  readonly deliveryState: "pending" | "delivered" | "claimed" | "acknowledged" | "disposed";
  readonly completionWake?: "always" | "settled_only";
  readonly deliveryTaskIds?: ReadonlyArray<NodeId>;
  readonly parentRunStatus?: "running" | "completed";
  readonly siblingTasks?: ReadonlyArray<{
    readonly id: NodeId;
    readonly deliveryState: "delivered" | "claimed";
  }>;
  readonly now: DateTime.Utc;
}) =>
  Effect.gen(function* () {
    const projects = yield* ProjectService.ProjectService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const providerThreadId = ProviderThreadId.make(
      `provider-thread:${String(input.threadId).replace("thread:", "")}`,
    );

    yield* projects.create({
      commandId: CommandId.make(`command:seed-project:${input.threadId}`),
      projectId: input.projectId,
      title: "Delegated completion delivery",
      workspaceRoot: `/workspace/${input.projectId}`,
    });

    yield* orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:seed-create:${input.threadId}`),
      threadId: input.threadId,
      projectId: input.projectId,
      title: "Delegated completion delivery",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });

    yield* eventSink.write({
      commandId: CommandId.make(`command:seed-projection:${input.threadId}`),
      events: [
        {
          id: EventId.make(`event:seed-provider-thread:${input.threadId}`),
          type: "provider-thread.updated",
          threadId: input.threadId,
          driver,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: input.now,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId: modelSelection.instanceId,
            providerSessionId: null,
            appThreadId: input.threadId,
            ownerNodeId: input.rootNodeId,
            nativeThreadRef: {
              driver,
              nativeId: `native:${input.threadId}`,
              strength: "strong",
            },
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: input.now,
            updatedAt: input.now,
          },
        },
        {
          id: EventId.make(`event:seed-run:${input.threadId}`),
          type: "run.updated",
          threadId: input.threadId,
          runId: input.runId,
          nodeId: input.rootNodeId,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: input.now,
          payload: {
            id: input.runId,
            threadId: input.threadId,
            ordinal: 1,
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make(`message:seed-user:${input.threadId}`),
            rootNodeId: input.rootNodeId,
            activeAttemptId: null,
            status: input.parentRunStatus ?? "running",
            requestedAt: input.now,
            startedAt: input.now,
            completedAt: input.parentRunStatus === "completed" ? input.now : null,
            checkpointId: null,
            contextHandoffId: null,
            delegatedCompletion: {
              disposition: "open",
              nextGeneration: 2,
              delivery:
                input.deliveryTaskIds === undefined
                  ? null
                  : {
                      generation: 1,
                      messageId: MessageId.make(`message:delegated-delivery:${input.threadId}`),
                      taskIds: input.deliveryTaskIds,
                    },
            },
          },
        },
        ...[
          { id: input.taskId, deliveryState: input.deliveryState },
          ...(input.siblingTasks ?? []),
        ].map((task) => ({
          id: EventId.make(`event:seed-task:${input.threadId}:${task.id}`),
          type: "subagent.updated" as const,
          threadId: input.threadId,
          runId: input.runId,
          nodeId: task.id,
          driver,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: input.now,
          payload: {
            id: task.id,
            threadId: input.threadId,
            runId: input.runId,
            parentNodeId: input.rootNodeId,
            origin: "app_owned" as const,
            createdBy: "agent" as const,
            driver,
            providerInstanceId: modelSelection.instanceId,
            providerThreadId: null,
            childThreadId: null,
            nativeTaskRef: null,
            prompt: "Inspect the delivered ownership edge.",
            title: null,
            model: null,
            completionWake: input.completionWake ?? "settled_only",
            completionDelivery: {
              state: task.deliveryState,
              observedByRunId: task.deliveryState === "acknowledged" ? input.runId : null,
            },
            status: "completed" as const,
            result: "child finished",
            startedAt: input.now,
            completedAt: input.now,
            updatedAt: input.now,
          },
        })),
      ],
    });
  });

it.layer(layerTest)("delegated completion delivery repairs", (it) => {
  it.effect(
    "interrupting a completion wake disposes both cohorts without reviving them on late results",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("stop-wake-parent");
        const originRunId = RunId.make("stop-wake-origin");
        const incomingTaskId = NodeId.make("stop-wake-incoming");
        yield* seedParentWithTerminalTask({
          threadId,
          projectId: ProjectId.make("stop-wake-project"),
          runId: originRunId,
          rootNodeId: NodeId.make("stop-wake-origin-root"),
          taskId: incomingTaskId,
          deliveryState: "claimed",
          deliveryTaskIds: [incomingTaskId],
          completionWake: "always",
          now,
        });
        const origin = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!;
        yield* sink.write({
          events: [
            {
              ...runEvent({ threadId, runId: originRunId, ordinal: 1, status: "completed", now }),
              payload: { ...origin, status: "completed", completedAt: now },
            },
          ],
        });
        const delivery = origin.delegatedCompletion!.delivery!;
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "agent",
          creationSource: "server",
          commandId: CommandId.make("stop-wake-start"),
          threadId,
          messageId: delivery.messageId,
          text: "Delegated task completed",
          attachments: [],
          modelSelection,
          dispatchMode: { type: "queue_after_active" },
          delegatedCompletion: {
            parentRunId: originRunId,
            generation: delivery.generation,
            taskIds: delivery.taskIds,
          },
        });
        yield* orchestrator.resumeQueuedRuns;
        const wake = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
          (run) => run.userMessageId === delivery.messageId,
        )!;
        yield* orchestrator.dispatch({
          type: "delegated_task.request",
          createdBy: "agent",
          creationSource: "mcp",
          commandId: CommandId.make("stop-wake-delegate"),
          parentThreadId: threadId,
          parentRunId: wake.id,
          parentNodeId: wake.rootNodeId!,
          task: "Do the next round",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          completionWake: "always",
        });
        const delegated = (yield* orchestrator.getThreadProjection(threadId)).subagents.find(
          (task) => task.runId === wake.id,
        )!;
        yield* orchestrator.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("stop-wake-interrupt"),
          threadId,
          runId: wake.id,
        });
        const stopped = yield* orchestrator.getThreadProjection(threadId);
        for (const runId of [originRunId, wake.id]) {
          const run = stopped.runs.find((row) => row.id === runId)!;
          assert.equal(run.delegatedCompletion?.disposition, "stopped");
          assert.isNull(run.delegatedCompletion?.delivery);
        }
        assert.equal(stopped.runs.find((run) => run.id === wake.id)?.status, "interrupted");
        for (const taskId of [incomingTaskId, delegated.id]) {
          assert.equal(
            stopped.subagents.find((task) => task.id === taskId)?.completionDelivery?.state,
            "disposed",
          );
        }
        assert.equal(
          stopped.subagents.find((task) => task.id === incomingTaskId)?.result,
          "child finished",
        );

        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("stop-wake-newer-work"),
          threadId,
          messageId: MessageId.make("stop-wake-newer-work"),
          text: "Start unrelated work",
          attachments: [],
          modelSelection,
          dispatchMode: { type: "queue_after_active" },
        });
        yield* orchestrator.resumeQueuedRuns;
        const newer = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(newer.runs.at(-1)?.status, "starting");

        const childThreadId = delegated.childThreadId!;
        const childRun = (yield* orchestrator.getThreadProjection(childThreadId)).runs[0]!;
        const afterSequence = yield* sink.latestSequence();
        yield* sink.write({
          events: [
            {
              ...runEvent({
                threadId: childThreadId,
                runId: childRun.id,
                ordinal: childRun.ordinal,
                status: "completed",
                now,
              }),
              payload: { ...childRun, status: "completed", completedAt: now },
            },
          ],
        });
        yield* sink.stream({ afterSequence, eventType: "subagent.updated" }).pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "subagent.updated" &&
              stored.event.payload.id === delegated.id &&
              stored.event.payload.status === "completed",
          ),
          Stream.take(1),
          Stream.runDrain,
        );
        const finished = yield* orchestrator.getThreadProjection(threadId);
        const lateTask = finished.subagents.find((task) => task.id === delegated.id)!;
        assert.equal(lateTask.status, "completed");
        assert.isNotNull(lateTask.result);
        assert.equal(lateTask.completionDelivery?.state, "disposed");
        assert.deepEqual(finished.runs, newer.runs);
        assert.deepEqual(finished.messages, newer.messages);
      }),
  );

  it.effect("acceptance batches pending siblings without acknowledging their results", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("mailbox-batch");
      const runId = RunId.make("mailbox-parent");
      const taskId = NodeId.make("mailbox-first");
      const messageId = MessageId.make(`message:delegated-delivery:${threadId}`);
      yield* seedParentWithTerminalTask({
        threadId,
        runId,
        projectId: ProjectId.make("mailbox-project"),
        rootNodeId: NodeId.make("mailbox-root"),
        taskId,
        deliveryState: "claimed",
        completionWake: "always",
        deliveryTaskIds: [taskId],
        now,
      });
      const projection = yield* orchestrator.getThreadProjection(threadId);
      const task = projection.subagents[0]!;
      const pendingIds = [NodeId.make("mailbox-second"), NodeId.make("mailbox-third")];
      yield* sink.write({
        events: [
          {
            id: EventId.make("mailbox-message"),
            type: "message.updated",
            threadId,
            runId,
            occurredAt: now,
            payload: {
              id: messageId,
              threadId,
              runId,
              nodeId: task.parentNodeId,
              role: "user",
              text: "Background task finished",
              attachments: [],
              streaming: false,
              createdBy: "agent",
              creationSource: "server",
              createdAt: now,
              updatedAt: now,
              delegatedCompletion: { parentRunId: runId, generation: 1, taskIds: [taskId] },
            },
          },
          ...pendingIds.map((id) => ({
            id: EventId.make(`event:${id}`),
            type: "subagent.updated" as const,
            threadId,
            runId,
            nodeId: id,
            occurredAt: now,
            payload: {
              ...task,
              id,
              completionDelivery: { state: "pending" as const, observedByRunId: null },
            },
          })),
        ],
      });
      yield* orchestrator.dispatch({
        type: "notification.delivery.accept",
        commandId: CommandId.make("accept-first"),
        threadId,
        messageId,
      });
      const accepted = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(
        accepted.subagents.find((row) => row.id === taskId)?.completionDelivery?.state,
        "delivered",
      );
      const cohort = accepted.runs.find((row) => row.id === runId)?.delegatedCompletion;
      assert.deepEqual(cohort?.delivery?.taskIds, pendingIds);
      assert.equal(cohort?.delivery?.generation, 2);
      for (const id of pendingIds) {
        assert.deepEqual(accepted.subagents.find((row) => row.id === id)?.completionDelivery, {
          state: "claimed",
          observedByRunId: null,
        });
      }
      yield* orchestrator.dispatch({
        type: "notification.delivery.accept",
        commandId: CommandId.make("repeat-old-acceptance"),
        threadId,
        messageId,
      });
      const duplicate = yield* orchestrator.getThreadProjection(threadId);
      assert.deepEqual(duplicate.runs.find((row) => row.id === runId)?.delegatedCompletion, cohort);
    }),
  );

  it.effect("acceptance batches a settled_only sibling once its spawning run ended", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("mailbox-mixed");
      const runId = RunId.make("mailbox-mixed-parent");
      const taskId = NodeId.make("mailbox-mixed-always");
      const siblingId = NodeId.make("mailbox-mixed-settled-only");
      const messageId = MessageId.make(`message:delegated-delivery:${threadId}`);
      yield* seedParentWithTerminalTask({
        threadId,
        runId,
        projectId: ProjectId.make("mailbox-mixed-project"),
        rootNodeId: NodeId.make("mailbox-mixed-root"),
        taskId,
        deliveryState: "claimed",
        completionWake: "always",
        deliveryTaskIds: [taskId],
        now,
      });
      const projection = yield* orchestrator.getThreadProjection(threadId);
      const task = projection.subagents[0]!;
      const spawningRun = projection.runs.find((row) => row.id === runId)!;
      yield* sink.write({
        events: [
          {
            ...runEvent({ threadId, runId, ordinal: 1, status: "cancelled", now }),
            payload: { ...spawningRun, status: "cancelled" as const, completedAt: now },
          },
          runEvent({
            threadId,
            runId: RunId.make("mailbox-mixed-continuation"),
            ordinal: 2,
            status: "running",
            now,
          }),
          {
            id: EventId.make("mailbox-mixed-message"),
            type: "message.updated",
            threadId,
            runId,
            occurredAt: now,
            payload: {
              id: messageId,
              threadId,
              runId,
              nodeId: task.parentNodeId,
              role: "user",
              text: "Background task finished",
              attachments: [],
              streaming: false,
              createdBy: "agent",
              creationSource: "server",
              createdAt: now,
              updatedAt: now,
              delegatedCompletion: { parentRunId: runId, generation: 1, taskIds: [taskId] },
            },
          },
          {
            id: EventId.make(`event:${siblingId}`),
            type: "subagent.updated" as const,
            threadId,
            runId,
            nodeId: siblingId,
            occurredAt: now,
            payload: {
              ...task,
              id: siblingId,
              completionWake: "settled_only" as const,
              completionDelivery: { state: "pending" as const, observedByRunId: null },
            },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "notification.delivery.accept",
        commandId: CommandId.make("accept-mixed"),
        threadId,
        messageId,
      });
      const accepted = yield* orchestrator.getThreadProjection(threadId);
      const cohort = accepted.runs.find((row) => row.id === runId)?.delegatedCompletion;
      assert.deepEqual(cohort?.delivery?.taskIds, [siblingId]);
      assert.equal(
        accepted.subagents.find((row) => row.id === siblingId)?.completionDelivery?.state,
        "claimed",
      );
    }),
  );

  it.effect("builds completion text and metadata from the same live cohort", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:delegated-delivery-live-cohort");
      const projectId = ProjectId.make("project:delegated-delivery-live-cohort");
      const runId = RunId.make("run:delegated-delivery-live-cohort");
      const rootNodeId = NodeId.make("node:delegated-delivery-live-cohort-root");
      const firstTaskId = NodeId.make("node:delegated-delivery-live-cohort-first");
      const secondTaskId = NodeId.make("node:delegated-delivery-live-cohort-second");
      const messageId = MessageId.make(`message:delegated-delivery:${threadId}`);

      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: firstTaskId,
        deliveryState: "claimed",
        completionWake: "always",
        deliveryTaskIds: [firstTaskId, secondTaskId],
        now,
      });

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("command:delegated-delivery-live-cohort"),
        threadId,
        messageId,
        text: `Delegated task ${firstTaskId} reached a terminal state.`,
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
        delegatedCompletion: {
          parentRunId: runId,
          generation: 1,
          taskIds: [firstTaskId],
        },
      });

      const projection = yield* orchestrator.getThreadProjection(threadId);
      const message = projection.messages.find((candidate) => candidate.id === messageId);
      assert.deepEqual(message?.delegatedCompletion?.taskIds, [firstTaskId, secondTaskId]);
      assert.include(message?.text ?? "", String(firstTaskId));
      assert.include(message?.text ?? "", String(secondTaskId));
      assert.include(message?.text ?? "", "task_status");
      assert.include(message?.text ?? "", "child finished");
    }),
  );

  it.effect("counts already delivered siblings in the completion notice", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:delegated-delivery-notice-count");
      const runId = RunId.make("run:delegated-delivery-notice-count");
      const firstTaskId = NodeId.make("node:delegated-delivery-notice-count-first");
      const secondTaskId = NodeId.make("node:delegated-delivery-notice-count-second");

      yield* seedParentWithTerminalTask({
        threadId,
        projectId: ProjectId.make("project:delegated-delivery-notice-count"),
        runId,
        rootNodeId: NodeId.make("node:delegated-delivery-notice-count-root"),
        taskId: firstTaskId,
        deliveryState: "claimed",
        completionWake: "always",
        deliveryTaskIds: [firstTaskId, secondTaskId],
        parentRunStatus: "completed",
        siblingTasks: [
          { id: secondTaskId, deliveryState: "claimed" },
          {
            id: NodeId.make("node:delegated-delivery-notice-count-earlier"),
            deliveryState: "delivered",
          },
        ],
        now,
      });

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("command:delegated-delivery-notice-count"),
        threadId,
        messageId: MessageId.make(`message:delegated-delivery:${threadId}`),
        text: "Delegated tasks reached a terminal state.",
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
        delegatedCompletion: { parentRunId: runId, generation: 1, taskIds: [firstTaskId] },
      });

      const projection = yield* orchestrator.getThreadProjection(threadId);
      const notice = projection.turnItems.find((item) => item.type === "notification");
      assert.match(
        notice?.type === "notification" ? notice.summary : "",
        /^2 of 3 delegated tasks finished:/,
      );
    }),
  );

  it.effect.each([
    {
      name: "oversized UTF-8 result",
      first: "界".repeat(6_000),
      second: "small result",
      inlineFirst: false,
      inlineSecond: true,
    },
    {
      name: "combined results",
      first: "a".repeat(10_000),
      second: "b".repeat(10_000),
      inlineFirst: true,
      inlineSecond: false,
    },
  ])("uses task_status for $name beyond the inline budget", (testCase) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make(`thread:inline-budget:${testCase.name}`);
      const runId = RunId.make(`run:inline-budget:${testCase.name}`);
      const firstTaskId = NodeId.make(`node:inline-first:${testCase.name}`);
      const secondTaskId = NodeId.make(`node:inline-second:${testCase.name}`);
      const messageId = MessageId.make(`message:delegated-delivery:${threadId}`);
      yield* seedParentWithTerminalTask({
        threadId,
        projectId: ProjectId.make(`project:inline-budget:${testCase.name}`),
        runId,
        rootNodeId: NodeId.make(`node:inline-budget:${testCase.name}`),
        taskId: firstTaskId,
        deliveryState: "claimed",
        completionWake: "always",
        deliveryTaskIds: [firstTaskId, secondTaskId],
        now,
      });
      const parent = yield* orchestrator.getThreadProjection(threadId);
      const task = parent.subagents[0]!;
      yield* sink.write({
        events: [
          { id: firstTaskId, result: testCase.first, status: "failed" as const },
          { id: secondTaskId, result: testCase.second, status: "cancelled" as const },
        ].map(({ id, result, status }) => ({
          id: EventId.make(`event:inline-budget:${id}`),
          type: "subagent.updated" as const,
          threadId,
          runId,
          nodeId: id,
          occurredAt: now,
          payload: { ...task, id, result, status, title: "Inspect regression" },
        })),
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:inline-budget:${testCase.name}`),
        threadId,
        messageId,
        text: "Delegated tasks completed.",
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
        delegatedCompletion: {
          parentRunId: runId,
          generation: 1,
          taskIds: [firstTaskId, secondTaskId],
        },
      });
      const projection = yield* orchestrator.getThreadProjection(threadId);
      const message = projection.messages.find((candidate) => candidate.id === messageId)!;
      assert.equal(message.text.includes(testCase.first), testCase.inlineFirst);
      assert.equal(message.text.includes(testCase.second), testCase.inlineSecond);
      const deferredTaskId = testCase.inlineFirst ? secondTaskId : firstTaskId;
      assert.include(
        message.text,
        `Delegated task ${deferredTaskId} (Inspect regression) [${testCase.inlineFirst ? "cancelled" : "failed"}]`,
      );
      assert.include(message.text, `Use task_status with taskId ${deferredTaskId}`);
      assert.deepEqual(message.delegatedCompletion?.taskIds, [firstTaskId, secondTaskId]);
      assert.equal(
        projection.subagents.find((candidate) => candidate.id === deferredTaskId)?.result,
        testCase.inlineFirst ? testCase.second : testCase.first,
      );
    }),
  );

  it.effect("does not re-offer when wake-policy upgrades after delivered ownership settled", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:delegated-delivery-a1");
      const projectId = ProjectId.make("project:delegated-delivery-a1");
      const runId = RunId.make("run:delegated-delivery-a1");
      const rootNodeId = NodeId.make("node:delegated-delivery-a1-root");
      const taskId = NodeId.make("node:delegated-delivery-a1-task");

      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId,
        deliveryState: "delivered",
        completionWake: "settled_only",
        now,
      });

      const upgrade = yield* orchestrator.dispatch({
        type: "delegated_task.wake-policy",
        commandId: CommandId.make("command:delegated-delivery-a1:wake-policy"),
        parentThreadId: threadId,
        taskId,
        completionWake: "always",
      });

      const projection = yield* orchestrator.getThreadProjection(threadId);
      const task = projection.subagents.find((candidate) => candidate.id === taskId);
      const parentRun = projection.runs.find((candidate) => candidate.id === runId);

      assert.equal(task?.completionWake, "always");
      assert.deepEqual(task?.completionDelivery, {
        state: "delivered",
        observedByRunId: null,
      });
      assert.deepEqual(parentRun?.delegatedCompletion, {
        disposition: "open",
        nextGeneration: 2,
        delivery: null,
      });
      assert.isFalse(
        upgrade.storedEvents.some(
          (stored) =>
            stored.event.type === "subagent.updated" &&
            stored.event.payload.id === taskId &&
            stored.event.payload.completionDelivery?.state === "claimed",
        ),
      );
      assert.isFalse(
        upgrade.storedEvents.some(
          (stored) =>
            stored.event.type === "run.updated" &&
            stored.event.payload.id === runId &&
            stored.event.payload.delegatedCompletion?.delivery !== null &&
            stored.event.payload.delegatedCompletion?.delivery !== undefined,
        ),
      );
    }),
  );

  it.effect(
    "treats repeated acknowledge and dispose with distinct command IDs as successful no-ops",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:delegated-delivery-a2");
        const projectId = ProjectId.make("project:delegated-delivery-a2");
        const runId = RunId.make("run:delegated-delivery-a2");
        const rootNodeId = NodeId.make("node:delegated-delivery-a2-root");
        const taskId = NodeId.make("node:delegated-delivery-a2-task");

        yield* seedParentWithTerminalTask({
          threadId,
          projectId,
          runId,
          rootNodeId,
          taskId,
          deliveryState: "delivered",
          completionWake: "always",
          now,
        });

        const firstAck = yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.acknowledge",
          commandId: CommandId.make("command:delegated-delivery-a2:ack-task-status"),
          parentThreadId: threadId,
          taskId,
          observedByRunId: runId,
        });
        const secondAck = yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.acknowledge",
          commandId: CommandId.make("command:delegated-delivery-a2:ack-thread-read"),
          parentThreadId: threadId,
          taskId,
          observedByRunId: runId,
        });

        const firstAckTask = firstAck.storedEvents.find(
          (stored) =>
            stored.event.type === "subagent.updated" && stored.event.payload.id === taskId,
        );
        const secondAckTask = secondAck.storedEvents.find(
          (stored) =>
            stored.event.type === "subagent.updated" && stored.event.payload.id === taskId,
        );
        assert.isDefined(firstAckTask);
        assert.isDefined(secondAckTask);
        if (
          firstAckTask?.event.type !== "subagent.updated" ||
          secondAckTask?.event.type !== "subagent.updated"
        ) {
          return yield* Effect.die(new Error("Acknowledge events missing."));
        }
        assert.equal(firstAckTask.event.payload.completionDelivery?.state, "acknowledged");
        assert.equal(secondAckTask.event.payload.completionDelivery?.state, "acknowledged");
        assert.deepEqual(
          secondAckTask.event.payload.completionDelivery,
          firstAckTask.event.payload.completionDelivery,
        );
        assert.deepEqual(
          secondAckTask.event.payload.updatedAt,
          firstAckTask.event.payload.updatedAt,
        );
        assert.equal(secondAck.storedEvents.length, 1);

        const afterAck = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(
          afterAck.subagents.find((candidate) => candidate.id === taskId)?.completionDelivery,
          {
            state: "acknowledged",
            observedByRunId: runId,
          },
        );

        const firstDispose = yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.dispose",
          commandId: CommandId.make("command:delegated-delivery-a2:dispose-task-status"),
          parentThreadId: threadId,
          taskId,
        });
        const secondDispose = yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.dispose",
          commandId: CommandId.make("command:delegated-delivery-a2:dispose-thread-read"),
          parentThreadId: threadId,
          taskId,
        });

        const firstDisposeTask = firstDispose.storedEvents.find(
          (stored) =>
            stored.event.type === "subagent.updated" && stored.event.payload.id === taskId,
        );
        const secondDisposeTask = secondDispose.storedEvents.find(
          (stored) =>
            stored.event.type === "subagent.updated" && stored.event.payload.id === taskId,
        );
        assert.isDefined(firstDisposeTask);
        assert.isDefined(secondDisposeTask);
        if (
          firstDisposeTask?.event.type !== "subagent.updated" ||
          secondDisposeTask?.event.type !== "subagent.updated"
        ) {
          return yield* Effect.die(new Error("Dispose events missing."));
        }
        assert.equal(firstDisposeTask.event.payload.completionDelivery?.state, "disposed");
        assert.equal(secondDisposeTask.event.payload.completionDelivery?.state, "disposed");
        assert.deepEqual(
          secondDisposeTask.event.payload.completionDelivery,
          firstDisposeTask.event.payload.completionDelivery,
        );
        assert.equal(secondDispose.storedEvents.length, 1);

        const afterDispose = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(
          afterDispose.subagents.find((candidate) => candidate.id === taskId)?.completionDelivery,
          {
            state: "disposed",
            observedByRunId: null,
          },
        );

        const acknowledgeAfterDispose = yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.acknowledge",
          commandId: CommandId.make("command:delegated-delivery-a2:ack-after-dispose"),
          parentThreadId: threadId,
          taskId,
          observedByRunId: runId,
        });
        const acknowledgedTask = acknowledgeAfterDispose.storedEvents.find(
          (stored) => stored.event.type === "subagent.updated",
        );
        if (acknowledgedTask?.event.type !== "subagent.updated") {
          return yield* Effect.die(new Error("Acknowledge-after-dispose event missing."));
        }
        assert.deepEqual(acknowledgedTask.event.payload.completionDelivery, {
          state: "disposed",
          observedByRunId: null,
        });
        assert.equal(acknowledgeAfterDispose.storedEvents.length, 1);

        const afterStaleAcknowledge = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(
          afterStaleAcknowledge.subagents.find((candidate) => candidate.id === taskId)
            ?.completionDelivery,
          {
            state: "disposed",
            observedByRunId: null,
          },
        );
      }),
  );

  it.effect.each([
    { command: "acknowledge", before: "running", after: "failed", capture: false },
    { command: "acknowledge", before: "waiting", after: "completed", capture: true },
    { command: "accept", before: "waiting", after: "completed", capture: true },
    { command: "wake-policy", before: "running", after: "completed", capture: true },
  ] as const)(
    "keeps a $after run that settled between $command's read and commit",
    ({ command, before, after, capture }) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const race = `${command}-settle-race-${after}`;
        const threadId = ThreadId.make(`thread:${race}`);
        const runId = RunId.make(`run:${race}`);
        const taskId = NodeId.make(`node:${race}-task`);
        const checkpointId = CheckpointId.make(`checkpoint:${race}`);
        const messageId = MessageId.make(`message:delegated-delivery:${threadId}`);
        const commandType = {
          acknowledge: "delegated_task.completion-delivery.acknowledge",
          accept: "notification.delivery.accept",
          "wake-policy": "delegated_task.wake-policy",
        }[command];
        yield* seedParentWithTerminalTask({
          threadId,
          projectId: ProjectId.make(`project:${race}`),
          runId,
          rootNodeId: NodeId.make(`node:${race}-root`),
          taskId,
          ...(command === "wake-policy"
            ? { deliveryState: "pending" }
            : { deliveryState: "claimed", deliveryTaskIds: [taskId] }),
          now,
        });
        const parent = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!;
        yield* sink.write({
          events: [
            {
              id: EventId.make(`event:${race}-before`),
              type: "run.updated",
              threadId,
              runId,
              occurredAt: now,
              payload: { ...parent, status: before },
            },
            {
              id: EventId.make(`event:${race}-message`),
              type: "message.updated",
              threadId,
              runId,
              occurredAt: now,
              payload: {
                id: messageId,
                threadId,
                runId,
                nodeId: parent.rootNodeId,
                role: "user",
                text: "Background task finished",
                attachments: [],
                streaming: false,
                createdBy: "agent",
                creationSource: "server",
                createdAt: now,
                updatedAt: now,
                delegatedCompletion: { parentRunId: runId, generation: 1, taskIds: [taskId] },
              },
            },
          ],
        });
        const { delegatedCompletion: _cohort, ...settledRun } = parent;
        const commit = sink.commitCommand;
        let settled = false;
        let planned: OrchestrationV2Run["delegatedCompletion"];
        yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            vi.spyOn(sink, "commitCommand").mockImplementation((input) =>
              Effect.gen(function* () {
                if (!settled && input.commandType === commandType) {
                  settled = true;
                  const plannedRun = input.events.find((event) => event.type === "run.updated");
                  planned =
                    plannedRun?.type === "run.updated"
                      ? plannedRun.payload.delegatedCompletion
                      : undefined;
                  // The provider turn ends (or its checkpoint lands) after the command read the run.
                  yield* commit({
                    commandId: CommandId.make(`command:${race}`),
                    threadId,
                    commandType: capture ? "checkpoint.capture" : "provider.event",
                    acceptedAt: now,
                    effects: [],
                    events: [
                      {
                        id: EventId.make(`event:${race}-settled`),
                        type: "run.updated",
                        threadId,
                        runId,
                        occurredAt: now,
                        payload: {
                          ...settledRun,
                          status: after,
                          completedAt: now,
                          checkpointId: capture ? checkpointId : null,
                        },
                      },
                    ],
                  });
                }
                return yield* commit(input);
              }),
            ),
          ),
          () =>
            orchestrator.dispatch(
              command === "accept"
                ? {
                    type: "notification.delivery.accept",
                    commandId: CommandId.make(`command:${race}:accept`),
                    threadId,
                    messageId,
                  }
                : command === "wake-policy"
                  ? {
                      type: "delegated_task.wake-policy",
                      commandId: CommandId.make(`command:${race}:wake-policy`),
                      parentThreadId: threadId,
                      taskId,
                      completionWake: "always",
                    }
                  : {
                      type: "delegated_task.completion-delivery.acknowledge",
                      commandId: CommandId.make(`command:${race}:task-status`),
                      parentThreadId: threadId,
                      taskId,
                      observedByRunId: runId,
                    },
            ),
          (spy) => Effect.sync(() => spy.mockRestore()),
        );
        assert.isTrue(settled);
        const finished = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          finished.subagents.find((row) => row.id === taskId)?.completionDelivery?.state,
          { acknowledge: "acknowledged", accept: "delivered", "wake-policy": "claimed" }[command],
        );
        const run = finished.runs.find((candidate) => candidate.id === runId)!;
        assert.deepEqual(
          {
            status: run.status,
            completedAt: run.completedAt,
            checkpointId: run.checkpointId,
            delegatedCompletion: run.delegatedCompletion,
          },
          {
            status: after,
            completedAt: now,
            checkpointId: capture ? checkpointId : null,
            delegatedCompletion: planned,
          },
        );
      }),
  );
});

const reconcileCommandId = (name: string) => CommandId.make(`command:runtime-reconcile:${name}`);

const parentProviderThreadId = (threadId: ThreadId) =>
  ProviderThreadId.make(`provider-thread:${String(threadId).replace("thread:", "")}`);

const runEvent = (input: {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly ordinal: number;
  readonly status: OrchestrationV2Run["status"];
  readonly now: DateTime.Utc;
  readonly providerThreadId?: ProviderThreadId;
  readonly userMessageId?: MessageId;
  readonly delegatedCompletion?: OrchestrationV2Run["delegatedCompletion"];
}) => ({
  id: EventId.make(`event:${input.runId}:${input.status}`),
  type: "run.updated" as const,
  threadId: input.threadId,
  runId: input.runId,
  providerInstanceId: modelSelection.instanceId,
  occurredAt: input.now,
  payload: {
    id: input.runId,
    threadId: input.threadId,
    ordinal: input.ordinal,
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    providerThreadId: input.providerThreadId ?? null,
    userMessageId: input.userMessageId ?? MessageId.make(`message:${input.runId}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: input.status,
    requestedAt: input.now,
    startedAt: input.now,
    completedAt: input.status === "running" ? null : input.now,
    checkpointId: null,
    contextHandoffId: null,
    ...(input.delegatedCompletion === undefined
      ? {}
      : { delegatedCompletion: input.delegatedCompletion }),
  },
});

const seedRestartCancelledChild = (input: {
  readonly parentThreadId: ThreadId;
  readonly projectId: ProjectId;
  readonly parentRunId: RunId;
  readonly rootNodeId: NodeId;
  readonly name: string;
  readonly completionWake: "always" | "settled_only";
  readonly continuationPending: boolean;
  readonly runStatus?: "cancelled" | "completed";
  readonly lostWork?: OrchestrationV2Run["restartCancelledBackgroundWork"];
  readonly now: DateTime.Utc;
}) =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const taskId = NodeId.make(`node:${input.name}`);
    const childThreadId = ThreadId.make(`thread:${input.name}`);
    const childRunId = RunId.make(`run:${input.name}:1`);
    yield* eventSink.write({
      commandId: CommandId.make(`command:seed-child:${input.name}`),
      events: [
        {
          id: EventId.make(`event:${input.name}:thread`),
          type: "thread.created",
          threadId: childThreadId,
          occurredAt: input.now,
          payload: {
            createdBy: "agent",
            creationSource: "server",
            id: childThreadId,
            projectId: input.projectId,
            title: input.name,
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: {
              parentThreadId: input.parentThreadId,
              relationshipToParent: "subagent",
              rootThreadId: input.parentThreadId,
            },
            forkedFrom: { type: "node", nodeId: taskId },
            createdAt: input.now,
            updatedAt: input.now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        },
        {
          id: EventId.make(`event:${input.name}:task`),
          type: "subagent.updated",
          threadId: input.parentThreadId,
          runId: input.parentRunId,
          nodeId: taskId,
          driver,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: input.now,
          payload: {
            id: taskId,
            threadId: input.parentThreadId,
            runId: input.parentRunId,
            parentNodeId: input.rootNodeId,
            origin: "app_owned",
            createdBy: "agent",
            driver,
            providerInstanceId: modelSelection.instanceId,
            providerThreadId: null,
            childThreadId,
            nativeTaskRef: null,
            prompt: `Run ${input.name}.`,
            title: null,
            model: null,
            completionWake: input.completionWake,
            status: "running",
            result: null,
            startedAt: input.now,
            completedAt: null,
            updatedAt: input.now,
          },
        },
      ],
    });
    const childRun = runEvent({
      threadId: childThreadId,
      runId: childRunId,
      ordinal: 1,
      status: input.runStatus ?? "cancelled",
      now: input.now,
    });
    yield* eventSink.writeWithEffects({
      commandId: reconcileCommandId(input.name),
      events: [
        input.lostWork === undefined
          ? childRun
          : {
              ...childRun,
              payload: { ...childRun.payload, restartCancelledBackgroundWork: input.lostWork },
            },
      ],
      effects: input.continuationPending
        ? [
            {
              id: `effect:restart-continuation:${childRunId}`,
              commandId: reconcileCommandId(input.name),
              threadId: childThreadId,
              request: { type: "provider-runtime.continue", sourceRunId: childRunId },
            },
          ]
        : [],
    });
    return { taskId, childThreadId, childRunId };
  });

it.layer(layerContinuationWorkerTest)("interrupted completion wakes", (it) => {
  it.effect.each([
    { name: "an interrupt keeps", holdQueue: false, siblingFinishesFirst: false },
    { name: "Stop disposes", holdQueue: true, siblingFinishesFirst: false },
    { name: "an interrupt reserves", holdQueue: false, siblingFinishesFirst: true },
  ])("$name a completion wake's other siblings", ({ holdQueue, siblingFinishesFirst }) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const key = holdQueue
        ? "sibling-stop"
        : siblingFinishesFirst
          ? "sibling-finished-interrupt"
          : "sibling-interrupt";
      const threadId = ThreadId.make(`${key}-parent`);
      const originRunId = RunId.make(`${key}-origin`);
      const incomingTaskId = NodeId.make(`${key}-incoming`);
      yield* seedParentWithTerminalTask({
        threadId,
        projectId: ProjectId.make(`${key}-project`),
        runId: originRunId,
        rootNodeId: NodeId.make(`${key}-origin-root`),
        taskId: incomingTaskId,
        deliveryState: "claimed",
        deliveryTaskIds: [incomingTaskId],
        completionWake: "always",
        now,
      });
      const originRootId = NodeId.make(`${key}-origin-root`);
      yield* sink.write({
        events: [
          {
            id: EventId.make(`event:${key}-origin-root`),
            type: "node.updated",
            threadId,
            runId: originRunId,
            nodeId: originRootId,
            occurredAt: now,
            payload: {
              id: originRootId,
              threadId,
              runId: originRunId,
              parentNodeId: null,
              rootNodeId: originRootId,
              kind: "root_turn",
              status: "running",
              countsForRun: true,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              runtimeRequestId: null,
              checkpointScopeId: null,
              startedAt: now,
              completedAt: null,
            },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "delegated_task.request",
        createdBy: "agent",
        creationSource: "mcp",
        commandId: CommandId.make(`${key}-sibling`),
        parentThreadId: threadId,
        parentRunId: originRunId,
        parentNodeId: originRootId,
        task: "Keep working",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        completionWake: "always",
      });
      const seeded = yield* orchestrator.getThreadProjection(threadId);
      const origin = seeded.runs.find((run) => run.id === originRunId)!;
      const sibling = seeded.subagents.find((task) => task.id !== incomingTaskId)!;
      yield* sink.write({
        events: [
          {
            ...runEvent({ threadId, runId: originRunId, ordinal: 1, status: "completed", now }),
            payload: { ...origin, status: "completed", completedAt: now },
          },
        ],
      });
      const delivery = origin.delegatedCompletion!.delivery!;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "agent",
        creationSource: "server",
        commandId: CommandId.make(`${key}-wake`),
        threadId,
        messageId: delivery.messageId,
        text: "Delegated task completed",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "queue_after_active" },
        delegatedCompletion: {
          parentRunId: originRunId,
          generation: delivery.generation,
          taskIds: delivery.taskIds,
        },
      });
      yield* orchestrator.resumeQueuedRuns;
      const wake = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
        (run) => run.userMessageId === delivery.messageId,
      )!;
      const childRun = (yield* orchestrator.getThreadProjection(sibling.childThreadId!)).runs[0]!;
      const completeSibling = Effect.gen(function* () {
        const afterSequence = yield* sink.latestSequence();
        yield* sink.write({
          events: [
            {
              ...runEvent({
                threadId: sibling.childThreadId!,
                runId: childRun.id,
                ordinal: childRun.ordinal,
                status: "completed",
                now,
              }),
              payload: { ...childRun, status: "completed", completedAt: now },
            },
          ],
        });
        return yield* sink.stream({ afterSequence, eventType: "subagent.updated" }).pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "subagent.updated" &&
              stored.event.payload.id === sibling.id &&
              stored.event.payload.status === "completed",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.as(afterSequence),
        );
      });
      if (siblingFinishesFirst) {
        yield* completeSibling;
        assert.equal(
          (yield* orchestrator.getThreadProjection(threadId)).subagents.find(
            (task) => task.id === sibling.id,
          )?.completionDelivery?.state,
          "pending",
        );
      }
      const beforeInterrupt = yield* sink.latestSequence();
      const interrupted = yield* orchestrator.dispatch({
        type: "run.interrupt",
        commandId: CommandId.make(`${key}-interrupt`),
        threadId,
        runId: wake.id,
        ...(holdQueue ? { holdQueue } : {}),
      });
      // The wake's terminal may claim the sibling right after commit, so read what the interrupt
      // itself wrote rather than a later projection.
      const interruptDelivery = new Map(
        interrupted.storedEvents.flatMap(({ event }) =>
          event.type === "subagent.updated"
            ? [[event.payload.id, event.payload.completionDelivery?.state] as const]
            : [],
        ),
      );
      const interruptCohort = interrupted.storedEvents.flatMap(({ event }) =>
        event.type === "run.updated" && event.payload.id === originRunId
          ? [event.payload.delegatedCompletion]
          : [],
      );
      assert.equal(interruptDelivery.get(incomingTaskId), "disposed");
      assert.equal(interruptCohort.at(-1)?.disposition, holdQueue ? "stopped" : "open");
      if (holdQueue) {
        assert.equal(interruptDelivery.get(sibling.id), "disposed");
        return;
      }
      assert.isFalse(interruptDelivery.has(sibling.id));

      const afterSequence = siblingFinishesFirst ? beforeInterrupt : yield* completeSibling;
      // The wake's terminal, or the sibling's own completion, reserves the successor.
      yield* sink.stream({ afterSequence, eventType: "subagent.updated" }).pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "subagent.updated" &&
            stored.event.payload.id === sibling.id &&
            stored.event.payload.completionDelivery?.state === "claimed",
        ),
        Stream.take(1),
        Stream.runDrain,
      );
      const woken = yield* orchestrator.getThreadProjection(threadId);
      const successor = woken.runs.find((run) => run.id === originRunId)?.delegatedCompletion
        ?.delivery;
      assert.equal(successor?.generation, delivery.generation + 1);
      assert.deepEqual(successor?.taskIds, [sibling.id]);
      assert.notEqual(successor?.messageId, delivery.messageId);

      // ProviderContinuationService consumes the claim's offer and dispatches the successor.
      yield* sink.stream({ afterSequence, eventType: "message.updated" }).pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "message.updated" &&
            stored.event.payload.id === successor!.messageId,
        ),
        Stream.take(1),
        Stream.runDrain,
      );
      // Repeated recovery re-offers every open delivery; none may wake the parent twice.
      yield* orchestrator.resumeQueuedRuns;
      yield* orchestrator.recoverDelegatedTasks;
      yield* orchestrator.recoverDelegatedTasks;
      yield* orchestrator.resumeQueuedRuns;
      const delivered = yield* orchestrator.getThreadProjection(threadId);
      const cohort = delivered.runs.find((run) => run.id === originRunId)?.delegatedCompletion;
      assert.equal(cohort?.disposition, "open");
      assert.equal(cohort?.nextGeneration, delivery.generation + 2);
      assert.deepEqual(cohort?.delivery, successor);
      assert.deepEqual(
        delivered.messages
          .filter((message) => message.delegatedCompletion?.parentRunId === originRunId)
          .map((message) => [message.id, message.delegatedCompletion]),
        [
          [
            delivery.messageId,
            {
              parentRunId: originRunId,
              generation: delivery.generation,
              taskIds: [incomingTaskId],
            },
          ],
          [
            successor!.messageId,
            { parentRunId: originRunId, generation: successor!.generation, taskIds: [sibling.id] },
          ],
        ],
      );
      const successorRuns = delivered.runs.filter(
        (run) => run.userMessageId === successor!.messageId,
      );
      assert.equal(successorRuns.length, 1);
      assert.equal(successorRuns[0]?.status, "starting");
      assert.equal(
        delivered.subagents.find((task) => task.id === sibling.id)?.completionDelivery?.state,
        "claimed",
      );
    }),
  );
});

it.layer(Layer.merge(layerTest, ProviderContinuationRequests.layer))(
  "subagent follow-ups",
  (it) => {
    it.effect("a late unobserved read wakes a pending result without restarting", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:late-read-live");
        const runId = RunId.make("run:late-read-live");
        const taskId = NodeId.make("task:late-read-live");
        yield* seedParentWithTerminalTask({
          threadId,
          projectId: ProjectId.make("project:late-read-live"),
          runId,
          rootNodeId: NodeId.make("root:late-read-live"),
          taskId,
          deliveryState: "pending",
          now,
        });
        const acknowledge = (key: string) =>
          orchestrator.dispatch({
            type: "delegated_task.completion-delivery.acknowledge",
            commandId: CommandId.make(`command:late-read-live:${key}`),
            parentThreadId: threadId,
            taskId,
            observedByRunId: null,
          });
        const before = yield* orchestrator.getThreadProjection(threadId);
        const liveRead = yield* acknowledge("live");
        assert.lengthOf(liveRead.storedEvents, 0);
        const parent = before.runs.find((run) => run.id === runId)!;
        yield* sink.write({
          events: [
            {
              id: EventId.make("event:late-read-live:parent-ended"),
              type: "run.updated",
              threadId,
              runId,
              occurredAt: now,
              payload: { ...parent, status: "completed", completedAt: now },
            },
          ],
        });
        yield* acknowledge("ended");
        const wake = yield* requests.take;
        assert.equal(wake.threadId, threadId);
        assert.equal(wake.delegatedCompletion?.parentRunId, runId);
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          after.subagents.find((task) => task.id === taskId)?.completionDelivery?.state,
          "claimed",
        );
        assert.deepEqual(
          after.runs.find((run) => run.id === runId)?.delegatedCompletion?.delivery?.taskIds,
          [taskId],
        );
        const repeated = yield* acknowledge("repeated");
        assert.lengthOf(repeated.storedEvents, 0);
        assert.deepEqual(yield* orchestrator.getThreadProjection(threadId), after);
        yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.dispose",
          commandId: CommandId.make("command:late-read-live:dispose"),
          parentThreadId: threadId,
          taskId,
        });
      }),
    );

    it.effect("recovers a reserved delivery without loading conversation history", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:bounded-delivery-recovery");
        const runId = RunId.make("run:bounded-delivery-recovery");
        const taskId = NodeId.make("task:bounded-delivery-recovery");
        yield* seedParentWithTerminalTask({
          threadId,
          runId,
          taskId,
          projectId: ProjectId.make("project:bounded-delivery-recovery"),
          rootNodeId: NodeId.make("node:bounded-delivery-recovery"),
          deliveryState: "claimed",
          deliveryTaskIds: [taskId],
          completionWake: "always",
          now,
        });
        for (const suffix of ["first", "second"]) {
          yield* sink.write({
            events: [
              {
                id: EventId.make(`event:bounded-delivery-history:${suffix}`),
                type: "message.updated",
                threadId,
                occurredAt: now,
                payload: {
                  id: MessageId.make(`message:bounded-delivery-history:${suffix}`),
                  threadId,
                  runId: null,
                  nodeId: null,
                  createdBy: "user",
                  creationSource: "web",
                  role: "user",
                  text: "Unrelated historical input",
                  attachments: [],
                  streaming: false,
                  createdAt: now,
                  updatedAt: now,
                },
              },
            ],
          });
        }
        const statements: string[] = [];
        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);
            const end = span.end.bind(span);
            span.end = (time, exit) => {
              end(time, exit);
              const query = span.attributes.get("db.query.text");
              if (typeof query === "string") statements.push(query);
            };
            return span;
          },
        });
        yield* orchestrator.recoverDelegatedTasks.pipe(Effect.withTracer(tracer));
        assert.isFalse(statements.some((query) => query.includes("MIN(ordinal)")));
        const messageReads = statements.filter((query) =>
          query.includes("FROM orchestration_v2_projection_messages"),
        );
        assert.isNotEmpty(messageReads);
        assert.isTrue(messageReads.every((query) => query.includes("message_id IN")));
        const wake = yield* requests.take;
        assert.equal(wake.delegatedCompletion?.parentRunId, runId);
      }),
    );
    it.effect("keeps a checkpoint completion committed between finalize's read and write", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:completion-capture-race");
        const projectId = ProjectId.make("project:completion-capture-race");
        const runId = RunId.make("run:completion-capture-race");
        const rootNodeId = NodeId.make("node:completion-capture-race");
        const checkpointId = CheckpointId.make("checkpoint:completion-capture-race");
        yield* seedParentWithTerminalTask({
          threadId,
          projectId,
          runId,
          rootNodeId,
          taskId: NodeId.make("node:completion-capture-seed"),
          deliveryState: "acknowledged",
          now,
        });
        const parent = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!;
        const waiting = { ...parent, status: "waiting" as const };
        yield* sink.write({
          events: [
            {
              id: EventId.make("event:completion-capture-waiting"),
              type: "run.updated",
              threadId,
              runId,
              occurredAt: now,
              payload: waiting,
            },
          ],
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId: threadId,
          projectId,
          parentRunId: runId,
          rootNodeId,
          name: "completion-capture-child",
          completionWake: "always",
          continuationPending: false,
          runStatus: "completed",
          now,
        });
        const write = sink.writeWithEffects;
        let captured = false;
        const committedParentRuns: Array<OrchestrationV2Run> = [];
        yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            vi.spyOn(sink, "writeWithEffects").mockImplementation((input) =>
              Effect.gen(function* () {
                if (
                  !captured &&
                  input.events.some(
                    (event) =>
                      event.type === "run.updated" &&
                      event.payload.id === runId &&
                      event.payload.delegatedCompletion?.delivery != null,
                  )
                ) {
                  captured = true;
                  // Commit capture after finalize planned its stale waiting snapshot.
                  const { delegatedCompletion: _cohort, ...captureRun } = waiting;
                  yield* sink.commitCommand({
                    commandId: CommandId.make("command:completion-capture-race"),
                    threadId,
                    commandType: "checkpoint.capture",
                    acceptedAt: now,
                    effects: [],
                    events: [
                      {
                        id: EventId.make("event:completion-capture-completed"),
                        type: "run.updated",
                        threadId,
                        runId,
                        occurredAt: now,
                        payload: {
                          ...captureRun,
                          status: "completed",
                          completedAt: now,
                          checkpointId,
                        },
                      },
                    ],
                  });
                }
                const stored = yield* write(input);
                for (const { event } of stored) {
                  if (event.type === "run.updated" && event.payload.id === runId) {
                    committedParentRuns.push(event.payload);
                  }
                }
                return stored;
              }),
            ),
          ),
          () => orchestrator.recoverDelegatedTasks,
          (spy) => Effect.sync(() => spy.mockRestore()),
        );
        assert.isTrue(captured);
        assert.equal(committedParentRuns.length, 1);
        const committedParentRun = committedParentRuns[0];
        assert.equal(committedParentRun?.status, "completed");
        assert.deepEqual(committedParentRun?.completedAt, now);
        assert.equal(committedParentRun?.checkpointId, checkpointId);
        assert.deepEqual(committedParentRun?.delegatedCompletion?.delivery?.taskIds, [
          child.taskId,
        ]);
        const finished = yield* orchestrator.getThreadProjection(threadId);
        const completed = finished.runs.find((run) => run.id === runId)!;
        assert.equal(completed.status, "completed");
        assert.deepEqual(completed.completedAt, now);
        assert.equal(completed.checkpointId, checkpointId);
        assert.deepEqual(completed.delegatedCompletion?.delivery?.taskIds, [child.taskId]);
        const wake = yield* requests.take;
        assert.equal(wake.delegatedCompletion?.parentRunId, runId);
        const delivery = completed.delegatedCompletion!.delivery!;
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "agent",
          creationSource: "server",
          commandId: CommandId.make("command:completion-capture-delivery"),
          threadId,
          messageId: delivery.messageId,
          text: "Child finished",
          attachments: [],
          delegatedCompletion: {
            parentRunId: runId,
            generation: delivery.generation,
            taskIds: delivery.taskIds,
          },
          dispatchMode: { type: "queue_after_active" },
        });
        const delivered = yield* orchestrator.getThreadProjection(threadId);
        const deliveryRun = delivered.runs.find((run) => run.userMessageId === delivery.messageId);
        assert.isDefined(deliveryRun);
        assert.notEqual(deliveryRun?.status, "queued");
      }),
    );
    it.effect("pauses queued follow-up cards and resumes them", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const parentThreadId = ThreadId.make("thread:held-followup-parent");
        const projectId = ProjectId.make("project:held-followup");
        const parentRunId = RunId.make("run:held-followup-parent");
        const rootNodeId = NodeId.make("node:held-followup-parent");
        yield* seedParentWithTerminalTask({
          threadId: parentThreadId,
          projectId,
          runId: parentRunId,
          rootNodeId,
          taskId: NodeId.make("node:held-followup-seed"),
          deliveryState: "acknowledged",
          now,
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId,
          projectId,
          parentRunId,
          rootNodeId,
          name: "held-followup-child",
          completionWake: "always",
          continuationPending: false,
          runStatus: "completed",
          now,
        });
        yield* orchestrator.recoverDelegatedTasks;
        const send = (name: string) =>
          orchestrator.dispatch({
            type: "message.dispatch",
            createdBy: "agent",
            creationSource: "mcp",
            commandId: CommandId.make(`command:held-followup:${name}`),
            threadId: child.childThreadId,
            senderThreadId: parentThreadId,
            messageId: MessageId.make(`message:held-followup:${name}`),
            text: name,
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
          });
        yield* send("active");
        yield* send("queued");
        const before = yield* orchestrator.getThreadProjection(child.childThreadId);
        const active = before.runs.find((run) => run.ordinal === 2)!;
        const queued = before.runs.find((run) => run.ordinal === 3)!;
        assert.equal(queued.status, "queued");
        const waitForStatus = (afterSequence: number, status: string) =>
          eventSink.stream({ afterSequence, eventType: "subagent.updated" }).pipe(
            Stream.filter(
              (stored) =>
                stored.event.type === "subagent.updated" &&
                stored.event.payload.id === queued.delegatedTaskId &&
                stored.event.payload.status === status,
            ),
            Stream.take(1),
            Stream.runHead,
          );
        const afterSequence = yield* eventSink.latestSequence();
        yield* orchestrator.dispatch({
          type: "thread.stop",
          threadId: child.childThreadId,
          commandId: CommandId.make("command:held-followup:stop"),
        });
        yield* waitForStatus(afterSequence, "idle");
        const paused = yield* orchestrator.getThreadProjection(parentThreadId);
        const task = paused.subagents.find((row) => row.id === queued.delegatedTaskId)!;
        assert.equal(task.status, "idle");
        assert.isNull(task.result);
        assert.equal(paused.nodes.find((row) => row.id === task.id)?.status, "idle");
        assert.equal(
          paused.turnItems.find((row) => row.type === "subagent" && row.subagentId === task.id)
            ?.status,
          "idle",
        );
        const endedSequence = yield* eventSink.latestSequence();
        yield* eventSink.write({
          events: [
            {
              id: EventId.make("event:held-followup-active-ended"),
              type: "run.updated",
              threadId: child.childThreadId,
              runId: active.id,
              occurredAt: now,
              payload: { ...active, status: "interrupted", startedAt: now, completedAt: now },
            },
          ],
        });
        const activeTask = (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
          (row) => row.id === active.delegatedTaskId,
        )!;
        if (activeTask.result === null) {
          yield* eventSink
            .stream({ afterSequence: endedSequence, eventType: "subagent.updated" })
            .pipe(
              Stream.filter(
                (stored) =>
                  stored.event.type === "subagent.updated" &&
                  stored.event.payload.id === active.delegatedTaskId &&
                  stored.event.payload.status === "interrupted",
              ),
              Stream.take(1),
              Stream.runHead,
            );
        }
        const shell = (yield* orchestrator.getShellSnapshot()).threads.find(
          (row) => row.id === parentThreadId,
        )!;
        assert.isFalse((shell.pendingBackgroundTasks ?? []).some((row) => row.taskId === task.id));
        const resumeSequence = yield* eventSink.latestSequence();
        yield* orchestrator.dispatch({
          type: "queue.resume",
          threadId: child.childThreadId,
          commandId: CommandId.make("command:held-followup:resume"),
        });
        yield* waitForStatus(resumeSequence, "running");
        const resumed = yield* orchestrator.getThreadProjection(parentThreadId);
        assert.equal(resumed.subagents.find((row) => row.id === task.id)?.status, "running");
        assert.isNull(resumed.subagents.find((row) => row.id === task.id)?.result);
      }),
    );

    it.effect("delivers the run a background command's wake starts after the original result", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
        const now = yield* DateTime.now;
        const parentThreadId = ThreadId.make("thread:background-wake-parent");
        const projectId = ProjectId.make("project:background-wake");
        const parentRunId = RunId.make("run:background-wake-parent");
        const rootNodeId = NodeId.make("node:background-wake-parent");
        yield* seedParentWithTerminalTask({
          threadId: parentThreadId,
          projectId,
          runId: parentRunId,
          rootNodeId,
          taskId: NodeId.make("node:background-wake-seed"),
          deliveryState: "acknowledged",
          now,
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId,
          projectId,
          parentRunId,
          rootNodeId,
          name: "background-wake-child",
          completionWake: "always",
          continuationPending: false,
          runStatus: "completed",
          now,
        });
        yield* orchestrator.recoverDelegatedTasks;
        let firstWake = yield* requests.take;
        while (firstWake.threadId !== parentThreadId) firstWake = yield* requests.take;
        yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.acknowledge",
          commandId: CommandId.make("command:background-wake-ack"),
          parentThreadId,
          taskId: child.taskId,
          observedByRunId: parentRunId,
        });
        const parentRun = (yield* orchestrator.getThreadProjection(parentThreadId)).runs.find(
          (run) => run.id === parentRunId,
        )!;
        yield* eventSink.write({
          commandId: reconcileCommandId("background-wake-parent-finished"),
          events: [
            {
              id: EventId.make("event:background-wake-parent-finished"),
              type: "run.updated",
              threadId: parentThreadId,
              runId: parentRunId,
              occurredAt: now,
              payload: { ...parentRun, status: "completed", completedAt: now },
            },
          ],
        });

        // The shape ProviderContinuationService dispatches when the provider
        // reports a background command (wire kind `background_command`) ended.
        const wakeMessageId = MessageId.make("message:background-wake");
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "agent",
          creationSource: "provider",
          commandId: CommandId.make("command:background-wake"),
          threadId: child.childThreadId,
          messageId: wakeMessageId,
          text: "Background activity updated",
          notification: {
            source: { kind: "command" },
            outcome: "completed",
            summary: 'Command "sleep 60" finished',
          },
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
        });
        const run = (yield* orchestrator.getThreadProjection(child.childThreadId)).runs.find(
          (row) => row.userMessageId === wakeMessageId,
        )!;
        assert.isDefined(run.delegatedTaskId);
        yield* eventSink.write({
          commandId: reconcileCommandId("background-wake-finished"),
          events: [
            {
              id: EventId.make("event:background-wake-result"),
              type: "message.updated",
              threadId: child.childThreadId,
              runId: run.id,
              occurredAt: now,
              payload: {
                id: MessageId.make("message:background-wake-result"),
                threadId: child.childThreadId,
                runId: run.id,
                nodeId: null,
                role: "assistant",
                text: "The background command finished cleanly.",
                attachments: [],
                streaming: false,
                createdBy: "agent",
                creationSource: "server",
                createdAt: now,
                updatedAt: now,
              },
            },
            {
              id: EventId.make("event:background-wake-finished"),
              type: "run.updated",
              threadId: child.childThreadId,
              runId: run.id,
              occurredAt: now,
              payload: { ...run, status: "completed", startedAt: now, completedAt: now },
            },
          ],
        });
        yield* orchestrator.recoverDelegatedTasks;
        const followup = (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
          (task) => task.id === run.delegatedTaskId,
        )!;
        assert.equal(followup.status, "completed");
        assert.equal(followup.result, "The background command finished cleanly.");
        assert.equal(followup.completionDelivery?.state, "claimed");
        let wake = yield* requests.take;
        while (
          wake.threadId !== parentThreadId ||
          wake.delegatedCompletion?.messageId === firstWake.delegatedCompletion?.messageId
        ) {
          wake = yield* requests.take;
        }
        assert.equal(wake.delegatedCompletion?.parentRunId, parentRunId);
      }),
    );

    const outcomes = [
      "completed",
      "failed",
      "interrupted",
      "restarted",
      "stopped",
      "overlapping",
    ] as const;
    it.effect.each(outcomes)(
      "delivers a %s follow-up independently of the original task",
      (outcome) =>
        Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const eventSink = yield* EventSink.EventSinkV2;
          const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
          const now = yield* DateTime.now;
          const parentThreadId = ThreadId.make(`thread:followup-${outcome}`);
          const projectId = ProjectId.make(`project:followup-${outcome}`);
          const parentRunId = RunId.make(`run:followup-${outcome}`);
          const rootNodeId = NodeId.make(`node:followup-${outcome}`);
          yield* seedParentWithTerminalTask({
            threadId: parentThreadId,
            projectId,
            runId: parentRunId,
            rootNodeId,
            taskId: NodeId.make(`node:seed-${outcome}`),
            deliveryState: "acknowledged",
            now,
          });
          const child = yield* seedRestartCancelledChild({
            parentThreadId,
            projectId,
            parentRunId,
            rootNodeId,
            name: `followup-child-${outcome}`,
            completionWake: "always",
            continuationPending: false,
            runStatus: "completed",
            now,
          });
          yield* orchestrator.recoverDelegatedTasks;
          let firstWake = yield* requests.take;
          while (firstWake.threadId !== parentThreadId) firstWake = yield* requests.take;
          assert.equal(firstWake.delegatedCompletion?.parentRunId, parentRunId);
          yield* orchestrator.dispatch({
            type: "delegated_task.completion-delivery.acknowledge",
            commandId: CommandId.make(`command:followup-ack-${outcome}`),
            parentThreadId,
            taskId: child.taskId,
            observedByRunId: parentRunId,
          });
          const original = (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
            (task) => task.id === child.taskId,
          )!;
          const parentRun = (yield* orchestrator.getThreadProjection(parentThreadId)).runs.find(
            (run) => run.id === parentRunId,
          )!;
          yield* eventSink.write({
            commandId: reconcileCommandId(`followup-parent-finished-${outcome}`),
            events: [
              {
                id: EventId.make(`event:followup-parent-finished-${outcome}`),
                type: "run.updated",
                threadId: parentThreadId,
                runId: parentRunId,
                occurredAt: now,
                payload: { ...parentRun, status: "completed", completedAt: now },
              },
            ],
          });
          const messageId = MessageId.make(`message:followup-${outcome}`);
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            createdBy: outcome === "failed" ? "user" : "agent",
            creationSource: outcome === "failed" ? "web" : "mcp",
            commandId: CommandId.make(`command:followup-send-${outcome}`),
            threadId: child.childThreadId,
            senderThreadId: parentThreadId,
            messageId,
            text: "Check the same work again.",
            attachments: [],
            dispatchMode: { type: "start_immediately" },
          });
          const childProjection = yield* orchestrator.getThreadProjection(child.childThreadId);
          let run = childProjection.runs.find((row) => row.userMessageId === messageId)!;
          assert.isDefined(run.delegatedTaskId);
          const workingParent = yield* orchestrator.getShellSnapshot();
          const backgroundTask = workingParent.threads
            .find((thread) => thread.id === parentThreadId)
            ?.pendingBackgroundTasks?.find((task) => task.kind === "subagent");
          assert.equal(backgroundTask?.childThreadId, child.childThreadId);
          if (outcome === "overlapping") {
            yield* orchestrator.dispatch({
              type: "message.dispatch",
              createdBy: "agent",
              creationSource: "mcp",
              commandId: CommandId.make("command:overlapping-followup"),
              threadId: child.childThreadId,
              senderThreadId: parentThreadId,
              messageId: MessageId.make("message:overlapping-followup"),
              text: "Keep working on another follow-up.",
              attachments: [],
              dispatchMode: { type: "queue_after_active" },
            });
          }
          if (outcome === "restarted") {
            const cut = { ...run, status: "cancelled" as const, startedAt: now, completedAt: now };
            yield* eventSink.writeWithEffects({
              commandId: reconcileCommandId("followup-restart-cut"),
              events: [
                {
                  id: EventId.make("event:followup-restart-cut"),
                  type: "run.updated",
                  threadId: child.childThreadId,
                  runId: run.id,
                  occurredAt: now,
                  payload: cut,
                },
              ],
              effects: [
                {
                  id: `effect:restart-continuation:${run.id}`,
                  commandId: reconcileCommandId("followup-restart-cut"),
                  threadId: child.childThreadId,
                  request: { type: "provider-runtime.continue", sourceRunId: run.id },
                },
              ],
            });
            yield* orchestrator.recoverDelegatedTasks;
            assert.isNull(
              (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
                (task) => task.id === run.delegatedTaskId,
              )!.result,
            );
            const continuationMessageId = MessageId.make("message:followup-restart-continuation");
            yield* orchestrator.dispatch({
              type: "message.dispatch",
              createdBy: "agent",
              creationSource: "server",
              commandId: CommandId.make("command:followup-restart-continuation"),
              threadId: child.childThreadId,
              restartContinuationOfRunId: run.id,
              messageId: continuationMessageId,
              text: "Continue where you left off.",
              attachments: [],
              dispatchMode: { type: "start_immediately" },
            });
            const continuation = (yield* orchestrator.getThreadProjection(
              child.childThreadId,
            )).runs.find((row) => row.userMessageId === continuationMessageId)!;
            assert.equal(continuation.delegatedTaskId, run.delegatedTaskId);
            run = continuation;
          }
          if (outcome === "stopped") {
            yield* orchestrator.dispatch({
              type: "thread.stop",
              threadId: parentThreadId,
              commandId: CommandId.make(`command:followup-stop-${outcome}`),
            });
          }
          yield* eventSink.write({
            commandId: reconcileCommandId(`followup-finish-${outcome}`),
            events: [
              {
                id: EventId.make(`event:followup-finish-${outcome}`),
                type: "run.updated",
                threadId: child.childThreadId,
                runId: run.id,
                occurredAt: now,
                payload: {
                  ...run,
                  status:
                    outcome === "stopped"
                      ? "interrupted"
                      : outcome === "restarted" || outcome === "overlapping"
                        ? "completed"
                        : outcome,
                  startedAt: now,
                  completedAt: now,
                },
              },
            ],
          });
          yield* orchestrator.recoverDelegatedTasks;
          const finished = yield* orchestrator.getThreadProjection(parentThreadId);
          assert.deepEqual(
            finished.subagents.find((task) => task.id === child.taskId),
            original,
          );
          const followup = finished.subagents.find((task) => task.id === run.delegatedTaskId)!;
          if (outcome === "overlapping") {
            const later = finished.subagents.find(
              (task) =>
                task.childThreadId === child.childThreadId &&
                task.id !== child.taskId &&
                task.id !== followup.id,
            )!;
            assert.equal(later.status, "pending");
            assert.isNull(later.result);
          }
          assert.equal(
            followup.status,
            outcome === "stopped"
              ? "interrupted"
              : outcome === "restarted" || outcome === "overlapping"
                ? "completed"
                : outcome,
          );
          assert.equal(
            followup.completionDelivery?.state,
            outcome === "stopped" ? "disposed" : "claimed",
          );
          if (outcome !== "stopped") {
            let wake = yield* requests.take;
            while (
              wake.threadId !== parentThreadId ||
              wake.delegatedCompletion?.messageId === firstWake.delegatedCompletion?.messageId
            ) {
              wake = yield* requests.take;
            }
            assert.equal(wake.delegatedCompletion?.parentRunId, parentRunId);
            assert.notEqual(
              wake.delegatedCompletion?.messageId,
              firstWake.delegatedCompletion?.messageId,
            );
          }
          assert.equal(
            finished.contextTransfers.filter(
              (transfer) =>
                transfer.type === "subagent_result" &&
                transfer.sourceThreadId === child.childThreadId,
            ).length,
            2,
          );
          yield* orchestrator.recoverDelegatedTasks;
          const recovered = yield* orchestrator.getThreadProjection(parentThreadId);
          assert.equal(recovered.contextTransfers.length, finished.contextTransfers.length);
          if (outcome === "completed") {
            const automaticMessageId = MessageId.make("message:followup-automatic-wake");
            yield* orchestrator.dispatch({
              type: "message.dispatch",
              createdBy: "agent",
              creationSource: "server",
              commandId: CommandId.make("command:followup-automatic-wake"),
              threadId: child.childThreadId,
              messageId: automaticMessageId,
              text: "A monitor reported new output.",
              attachments: [],
              notification: {
                source: { kind: "monitor" },
                outcome: "updated",
                summary: "Monitor updated",
              },
              dispatchMode: { type: "queue_after_active" },
            });
            const automatic = (yield* orchestrator.getThreadProjection(
              child.childThreadId,
            )).runs.find((run) => run.userMessageId === automaticMessageId)!;
            assert.isUndefined(automatic.delegatedTaskId);
            yield* eventSink.write({
              commandId: reconcileCommandId("followup-automatic-finished"),
              events: [
                {
                  id: EventId.make("event:followup-automatic-finished"),
                  type: "run.updated",
                  threadId: child.childThreadId,
                  runId: automatic.id,
                  occurredAt: now,
                  payload: { ...automatic, status: "completed", startedAt: now, completedAt: now },
                },
              ],
            });
            yield* orchestrator.recoverDelegatedTasks;
            const afterAutomatic = yield* orchestrator.getThreadProjection(parentThreadId);
            assert.deepEqual(afterAutomatic.subagents, recovered.subagents);
            assert.equal(afterAutomatic.contextTransfers.length, recovered.contextTransfers.length);
            const control = yield* seedRestartCancelledChild({
              parentThreadId,
              projectId,
              parentRunId,
              rootNodeId,
              name: "followup-control-child",
              completionWake: "always",
              continuationPending: false,
              runStatus: "completed",
              now,
            });
            yield* orchestrator.recoverDelegatedTasks;
            const afterControl = yield* orchestrator.getThreadProjection(parentThreadId);
            assert.equal(
              afterControl.subagents.find((task) => task.id === control.taskId)?.completionDelivery
                ?.state,
              "claimed",
            );
            assert.equal(
              afterControl.contextTransfers.filter(
                (transfer) =>
                  transfer.type === "subagent_result" &&
                  transfer.sourceThreadId === control.childThreadId,
              ).length,
              1,
            );
          }
        }),
    );

    it.effect("tracks a child's usage-limit auto-resume as a follow-up", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const parentThreadId = ThreadId.make("thread:limit-resume-parent");
        const projectId = ProjectId.make("project:limit-resume");
        const parentRunId = RunId.make("run:limit-resume-parent");
        const rootNodeId = NodeId.make("node:limit-resume-parent");
        yield* seedParentWithTerminalTask({
          threadId: parentThreadId,
          projectId,
          runId: parentRunId,
          rootNodeId,
          taskId: NodeId.make("node:limit-resume-seed"),
          deliveryState: "acknowledged",
          now,
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId,
          projectId,
          parentRunId,
          rootNodeId,
          name: "limit-resume-child",
          completionWake: "always",
          continuationPending: false,
          runStatus: "completed",
          now,
        });
        const childRun = (yield* orchestrator.getThreadProjection(child.childThreadId)).runs[0]!;
        yield* eventSink.write({
          commandId: reconcileCommandId("limit-resume-child-limited"),
          events: [
            {
              id: EventId.make("event:limit-resume-child-failed"),
              type: "run.updated",
              threadId: child.childThreadId,
              runId: childRun.id,
              occurredAt: now,
              payload: { ...childRun, status: "failed", completedAt: now },
            },
            {
              id: EventId.make("event:limit-resume-child-error"),
              type: "turn-item.updated",
              threadId: child.childThreadId,
              occurredAt: now,
              payload: {
                id: TurnItemId.make("turn-item:limit-resume-child-error"),
                type: "error",
                threadId: child.childThreadId,
                runId: childRun.id,
                nodeId: childRun.rootNodeId,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 1,
                status: "failed",
                title: "Usage limit reached",
                startedAt: now,
                completedAt: now,
                updatedAt: now,
                failure: {
                  class: "usage_limit",
                  message: "Plan limit reached.",
                  code: "usageLimitExceeded",
                  retryable: null,
                  resetAt: DateTime.formatIso(DateTime.add(now, { minutes: 1 })),
                },
              },
            },
          ],
        });
        yield* orchestrator.recoverDelegatedTasks;
        const childShell = Effect.map(orchestrator.getShellSnapshot(), (snapshot) =>
          snapshot.threads.find((thread) => thread.id === child.childThreadId),
        );
        const arm = limitRecoveryCommand((yield* childShell)!, true, DateTime.toEpochMillis(now));
        assert(arm?.type === "thread.metadata.update" && arm.limitRecovery != null);
        yield* orchestrator.autoArmLimitRecovery({
          commandId: arm.commandId,
          threadId: arm.threadId,
          limitRecovery: arm.limitRecovery,
        });
        yield* TestClock.adjust("1 minute");
        const resume = limitRecoveryCommand(
          (yield* childShell)!,
          true,
          DateTime.toEpochMillis(yield* DateTime.now),
        );
        assert(resume?.type === "message.dispatch");
        yield* orchestrator.dispatch(resume);

        const resumed = (yield* orchestrator.getThreadProjection(child.childThreadId)).runs.find(
          (run) => run.userMessageId === resume.messageId,
        );
        assert.isDefined(resumed?.delegatedTaskId);
        const followup = (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
          (task) => task.id === resumed?.delegatedTaskId,
        );
        assert.equal(followup?.childThreadId, child.childThreadId);
        assert.isNull(followup?.result);
      }),
    );

    it.effect("serializes a recovered child answer with its parent and tracks the follow-up", () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const parentThreadId = ThreadId.make("thread:question-answer-parent");
        const projectId = ProjectId.make("project:question-answer");
        const parentRunId = RunId.make("run:question-answer-parent");
        const rootNodeId = NodeId.make("node:question-answer-parent");
        yield* seedParentWithTerminalTask({
          threadId: parentThreadId,
          projectId,
          runId: parentRunId,
          rootNodeId,
          taskId: NodeId.make("node:question-answer-seed"),
          deliveryState: "acknowledged",
          now,
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId,
          projectId,
          parentRunId,
          rootNodeId,
          name: "question-answer-child",
          completionWake: "always",
          continuationPending: false,
          now,
        });
        // The cancelled result is published before anyone answers the question.
        yield* orchestrator.recoverDelegatedTasks;
        assert.isNotNull(
          (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
            (task) => task.id === child.taskId,
          )?.result,
        );
        const parentRun = (yield* orchestrator.getThreadProjection(parentThreadId)).runs.find(
          (run) => run.id === parentRunId,
        )!;
        yield* eventSink.write({
          events: [
            {
              id: EventId.make("event:question-answer-parent-completed"),
              type: "run.updated",
              threadId: parentThreadId,
              runId: parentRunId,
              occurredAt: now,
              payload: { ...parentRun, status: "completed", completedAt: now },
            },
          ],
        });
        const requestId = RuntimeRequestId.make("request:question-answer");
        const nodeId = NodeId.make("node:question-answer-request");
        yield* eventSink.write({
          commandId: CommandId.make("command:seed-question-answer"),
          events: [
            {
              id: EventId.make("event:question-answer-request"),
              type: "runtime-request.updated",
              threadId: child.childThreadId,
              nodeId,
              occurredAt: now,
              payload: {
                id: requestId,
                nodeId,
                providerTurnId: null,
                nativeRequestRef: null,
                kind: "user_input",
                status: "pending",
                responseCapability: { type: "message" },
                createdAt: now,
                resolvedAt: null,
              },
            },
            {
              id: EventId.make("event:question-answer-item"),
              type: "turn-item.updated",
              threadId: child.childThreadId,
              nodeId,
              occurredAt: now,
              payload: {
                id: TurnItemId.make("turn-item:question-answer"),
                type: "user_input_request",
                threadId: child.childThreadId,
                runId: child.childRunId,
                nodeId,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 0,
                status: "waiting",
                title: null,
                startedAt: now,
                completedAt: null,
                updatedAt: now,
                requestId,
                questions: [
                  { id: "color", header: "Color", question: "Which color?", options: [] },
                ],
              },
            },
          ],
        });

        const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
        const parentHeld = yield* Deferred.make<void>();
        const releaseParent = yield* Deferred.make<void>();
        const answerWaiting = yield* Deferred.make<void>();
        const withLock = executor.withLock;
        const parentMutation = yield* withLock(
          parentThreadId,
          Deferred.succeed(parentHeld, undefined).pipe(
            Effect.andThen(Deferred.await(releaseParent)),
          ),
        ).pipe(Effect.forkScoped({ startImmediately: true }));
        yield* Deferred.await(parentHeld);
        const observeLock: ThreadCommandExecutor.ThreadCommandExecutor["Service"]["withLock"] = (
          key,
          effect,
        ) =>
          key === parentThreadId
            ? Deferred.succeed(answerWaiting, undefined).pipe(Effect.andThen(withLock(key, effect)))
            : withLock(key, effect);
        const spy = vi.spyOn(executor, "withLock").mockImplementation(observeLock);
        yield* Effect.gen(function* () {
          const answer = yield* orchestrator
            .dispatch({
              type: "runtime-request.respond",
              commandId: CommandId.make("command:question-answer"),
              threadId: child.childThreadId,
              requestId,
              answers: { color: "Blue" },
            })
            .pipe(Effect.forkScoped({ startImmediately: true }));
          yield* Effect.raceFirst(Deferred.await(answerWaiting), Fiber.join(answer));
          const waiting = yield* orchestrator.getThreadProjection(child.childThreadId);
          assert.equal(
            waiting.runtimeRequests.find((row) => row.id === requestId)?.status,
            "pending",
          );
          assert.isFalse((yield* executor.activeKeys).includes(child.childThreadId));
          yield* Deferred.succeed(releaseParent, undefined);
          yield* Fiber.join(parentMutation);
          yield* Fiber.join(answer);
        }).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())));

        const answerRun = (yield* orchestrator.getThreadProjection(child.childThreadId)).runs.find(
          (run) => run.userMessageId === MessageId.make(`async-answer:${requestId}`),
        );
        assert.isDefined(answerRun?.delegatedTaskId);
        const followup = (yield* orchestrator.getThreadProjection(parentThreadId)).subagents.find(
          (task) => task.id === answerRun?.delegatedTaskId,
        );
        assert.equal(followup?.childThreadId, child.childThreadId);
        assert.isNull(followup?.result);
        assert.isTrue(
          (yield* orchestrator.getThreadShell(parentThreadId))?.pendingBackgroundTasks?.some(
            (task) => task.kind === "subagent" && task.childThreadId === child.childThreadId,
          ),
        );
      }),
    );
  },
);

it.layer(layerTest)("delegated tasks across a server restart", (it) => {
  it.effect("queues a child result without creating a provider history handoff", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:result-message-parent");
      const projectId = ProjectId.make("project:result-message");
      const runId = RunId.make("run:result-message-parent");
      const rootNodeId = NodeId.make("node:result-message-parent");
      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: NodeId.make("node:result-message-seed"),
        deliveryState: "acknowledged",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId: threadId,
        projectId,
        parentRunId: runId,
        rootNodeId,
        name: "result-message-child",
        completionWake: "always",
        continuationPending: false,
        runStatus: "completed",
        now,
      });
      const parent = yield* orchestrator.getThreadProjection(threadId);
      const childProjection = yield* orchestrator.getThreadProjection(child.childThreadId);
      const providerThreadId = ProviderThreadId.make("provider-thread:result-message-child");
      yield* eventSink.write({
        commandId: CommandId.make("command:result-message-child-provider"),
        events: [
          {
            id: EventId.make("event:result-message-child-provider"),
            type: "provider-thread.updated",
            threadId: child.childThreadId,
            occurredAt: now,
            payload: {
              ...parent.providerThreads[0]!,
              id: providerThreadId,
              appThreadId: child.childThreadId,
            },
          },
          {
            id: EventId.make("event:result-message-child-run"),
            type: "run.updated",
            threadId: child.childThreadId,
            runId: child.childRunId,
            occurredAt: now,
            payload: { ...childProjection.runs[0]!, providerThreadId },
          },
        ],
      });

      yield* orchestrator.recoverDelegatedTasks;
      const recovered = yield* orchestrator.getThreadProjection(threadId);
      const task = recovered.subagents.find((candidate) => candidate.id === child.taskId)!;
      assert.equal(task.status, "completed");
      assert.isNotNull(task.result);
      assert.isEmpty(recovered.contextHandoffs);
      assert.equal(recovered.contextTransfers.length, 1);

      const delivery = recovered.runs.find((candidate) => candidate.id === runId)!
        .delegatedCompletion!.delivery!;
      const messageId = delivery.messageId;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("command:result-message-delivery"),
        threadId,
        messageId,
        text: "Delegated task finished.",
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
        delegatedCompletion: {
          parentRunId: runId,
          generation: delivery.generation,
          taskIds: [child.taskId],
        },
      });
      const queued = yield* orchestrator.getThreadProjection(threadId);
      assert.include(
        queued.messages.find((message) => message.id === messageId)?.text ?? "",
        task.result!,
      );
    }),
  );

  it.effect("holds a restart-cancelled child for its continuation's result", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:restart-parent");
      const projectId = ProjectId.make("project:restart-parent");
      const runId = RunId.make("run:restart-parent");
      const rootNodeId = NodeId.make("node:restart-parent-root");
      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: NodeId.make("node:restart-parent-settled"),
        deliveryState: "delivered",
        now,
      });
      const child = (
        name: string,
        continuationPending: boolean,
        runStatus?: "cancelled" | "completed",
      ) =>
        seedRestartCancelledChild({
          parentThreadId: threadId,
          projectId,
          parentRunId: runId,
          rootNodeId,
          name,
          completionWake: "always",
          continuationPending,
          ...(runStatus === undefined ? {} : { runStatus }),
          now,
        });
      const resumed = yield* child("restart-resumed-child", true);
      const stopped = yield* child("restart-stopped-child", false);
      const backgrounded = yield* child("restart-backgrounded-child", true, "completed");
      const recut = yield* child("restart-recut-child", false);
      const recutContinuationId = RunId.make("run:restart-recut-child:2");
      const recutCommandId = CommandId.make("command:restart-recut-child:reconcile");
      const recutRun = runEvent({
        threadId: recut.childThreadId,
        runId: recutContinuationId,
        ordinal: 2,
        status: "cancelled",
        now,
      });
      yield* eventSink.writeWithEffects({
        commandId: recutCommandId,
        events: [
          {
            ...recutRun,
            payload: {
              ...recutRun.payload,
              startedAt: null,
              restartContinuationOfRunId: recut.childRunId,
            },
          },
        ],
        effects: [
          {
            id: `effect:restart-continuation:${recutContinuationId}`,
            commandId: recutCommandId,
            threadId: recut.childThreadId,
            request: { type: "provider-runtime.continue", sourceRunId: recutContinuationId },
          },
        ],
      });

      yield* orchestrator.recoverDelegatedTasks;

      const recovered = yield* orchestrator.getThreadProjection(threadId);
      const task = (id: NodeId) => recovered.subagents.find((row) => row.id === id);
      assert.equal(task(stopped.taskId)?.status, "cancelled");
      assert.equal(task(stopped.taskId)?.completionDelivery?.state, "claimed");
      assert.equal(task(resumed.taskId)?.status, "running");
      assert.isNull(task(resumed.taskId)?.result ?? null);
      assert.equal(task(backgrounded.taskId)?.status, "running");
      assert.isNull(task(backgrounded.taskId)?.result ?? null);
      assert.equal(task(recut.taskId)?.status, "running");
      assert.isTrue(yield* orchestrator.delegatedTaskResultPending(recut.childThreadId));
      assert.isTrue(yield* orchestrator.delegatedTaskResultPending(resumed.childThreadId));
      assert.isFalse(yield* orchestrator.delegatedTaskResultPending(stopped.childThreadId));
      yield* orchestrator.recoverDelegatedTask(recut.childThreadId, recut.childRunId);
      const replayed = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(replayed.subagents.find((row) => row.id === recut.taskId)?.status, "running");
      yield* eventSink.write({
        commandId: CommandId.make("command:restart-stopped-child:resumed"),
        events: [
          runEvent({
            threadId: stopped.childThreadId,
            runId: RunId.make("run:restart-stopped-child:2"),
            ordinal: 2,
            status: "running",
            now,
          }),
        ],
      });
      assert.isTrue(yield* orchestrator.delegatedTaskResultPending(stopped.childThreadId));
      assert.isFalse(
        recovered.contextTransfers.some(
          (transfer) => transfer.sourceThreadId === resumed.childThreadId,
        ),
      );

      const afterSequence = yield* eventSink.latestSequence();
      const continuationRunId = RunId.make("run:restart-resumed-child:2");
      yield* eventSink.write({
        commandId: CommandId.make("command:restart-resumed-child:completed"),
        events: [
          {
            id: EventId.make("event:restart-resumed-child:result"),
            type: "message.updated",
            threadId: resumed.childThreadId,
            runId: continuationRunId,
            occurredAt: now,
            payload: {
              id: MessageId.make("message:restart-resumed-child:result"),
              threadId: resumed.childThreadId,
              runId: continuationRunId,
              nodeId: null,
              role: "assistant",
              text: "Finished after the restart.",
              attachments: [],
              streaming: false,
              createdBy: "agent",
              creationSource: "server",
              createdAt: now,
              updatedAt: now,
            },
          },
          runEvent({
            threadId: resumed.childThreadId,
            runId: continuationRunId,
            ordinal: 2,
            status: "completed",
            now,
          }),
        ],
      });
      const settled = yield* eventSink
        .stream({ afterSequence, eventType: "subagent.updated" })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "subagent.updated" &&
              stored.event.payload.id === resumed.taskId,
          ),
          Stream.take(1),
          Stream.runHead,
        );
      assert.isTrue(settled._tag === "Some");
      const finished = yield* orchestrator.getThreadProjection(threadId);
      const finishedTask = finished.subagents.find((row) => row.id === resumed.taskId);
      assert.equal(finishedTask?.status, "completed");
      assert.equal(finishedTask?.result, "Finished after the restart.");
    }),
  );

  it.effect("settles a restart-cancelled child whose continuation declines to start", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:restart-declined-parent");
      const projectId = ProjectId.make("project:restart-declined-parent");
      const runId = RunId.make("run:restart-declined-parent");
      const rootNodeId = NodeId.make("node:restart-declined-parent-root");
      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: NodeId.make("node:restart-declined-parent-settled"),
        deliveryState: "delivered",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId: threadId,
        projectId,
        parentRunId: runId,
        rootNodeId,
        name: "restart-declined-child",
        completionWake: "always",
        continuationPending: true,
        now,
      });
      yield* orchestrator.recoverDelegatedTasks;
      const held = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(held.subagents.find((row) => row.id === child.taskId)?.status, "running");

      yield* continueRestartedRun({
        threadId: child.childThreadId,
        sourceRunId: child.childRunId,
      }).pipe(
        Effect.provide(ServerSettings.layerTest({ continueThreadsAfterServerUpdate: false })),
      );

      const settled = yield* orchestrator.getThreadProjection(threadId);
      const task = settled.subagents.find((row) => row.id === child.taskId);
      assert.equal(task?.status, "cancelled");
      assert.equal(task?.completionDelivery?.state, "claimed");

      // The parent's Stop committed, but the restart cut the effect that stops its children.
      const stoppedChild = yield* seedRestartCancelledChild({
        parentThreadId: threadId,
        projectId,
        parentRunId: runId,
        rootNodeId,
        name: "restart-parent-stopped-child",
        completionWake: "always",
        continuationPending: true,
        now,
      });
      yield* (yield* EventSink.EventSinkV2).write({
        commandId: CommandId.make("command:restart-declined-parent:stop"),
        events: [
          {
            id: EventId.make("event:restart-declined-parent:interrupt-request"),
            type: "turn-item.updated",
            threadId,
            runId,
            nodeId: rootNodeId,
            providerInstanceId: modelSelection.instanceId,
            occurredAt: now,
            payload: {
              id: TurnItemId.make("turn-item:restart-declined-parent:interrupt-request"),
              type: "run_interrupt_request",
              threadId,
              runId,
              nodeId: rootNodeId,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 90,
              status: "completed",
              title: "Interrupt requested",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              message: "Stopped by user",
            },
          },
        ],
      });
      yield* continueRestartedRun({
        threadId: stoppedChild.childThreadId,
        sourceRunId: stoppedChild.childRunId,
      }).pipe(Effect.provide(ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true })));
      const afterStop = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(
        afterStop.subagents.find((row) => row.id === stoppedChild.taskId)?.status,
        "cancelled",
      );
      assert.deepEqual(
        (yield* orchestrator.getThreadProjection(stoppedChild.childThreadId)).runs.map(
          (run) => run.id,
        ),
        [stoppedChild.childRunId],
      );
    }),
  );

  it.effect("reports a child whose monitor the restart cut as interrupted, not completed", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:restart-monitor-parent");
      const projectId = ProjectId.make("project:restart-monitor-parent");
      const runId = RunId.make("run:restart-monitor-parent");
      const rootNodeId = NodeId.make("node:restart-monitor-parent-root");
      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: NodeId.make("node:restart-monitor-parent-settled"),
        deliveryState: "delivered",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId: threadId,
        projectId,
        parentRunId: runId,
        rootNodeId,
        name: "restart-monitor-child",
        completionWake: "always",
        continuationPending: true,
        runStatus: "completed",
        lostWork: [{ kind: "monitor", label: "Gate attempt 9", awaited: true }],
        now,
      });
      yield* orchestrator.recoverDelegatedTasks;
      const held = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(held.subagents.find((row) => row.id === child.taskId)?.status, "running");

      yield* continueRestartedRun({
        threadId: child.childThreadId,
        sourceRunId: child.childRunId,
      }).pipe(
        Effect.provide(ServerSettings.layerTest({ continueThreadsAfterServerUpdate: false })),
      );

      const settled = yield* orchestrator.getThreadProjection(threadId);
      const task = settled.subagents.find((row) => row.id === child.taskId);
      assert.equal(task?.status, "interrupted");
      assert.equal(task?.result, "Child task ended with status interrupted.");
      assert.equal(task?.completionDelivery?.state, "claimed");
    }),
  );

  // Running does not prove prompt consumption in Claude; re-offer cut deliveries even when resuming the turn.
  it.effect("re-offers a cut delivery even when a continuation resumes its turn", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const seed = (name: string, continuationPending: boolean) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make(`thread:${name}`);
          const runId = RunId.make(`run:${name}`);
          const taskId = NodeId.make(`node:${name}-task`);
          const messageId = MessageId.make(`message:delegated-delivery:${threadId}`);
          const deliveryRunId = RunId.make(`run:${name}:delivery`);
          yield* seedParentWithTerminalTask({
            threadId,
            projectId: ProjectId.make(`project:${name}`),
            runId,
            rootNodeId: NodeId.make(`node:${name}-root`),
            taskId,
            deliveryState: "claimed",
            completionWake: "always",
            deliveryTaskIds: [taskId],
            now,
          });
          yield* eventSink.writeWithEffects({
            commandId: reconcileCommandId(name),
            events: [
              {
                id: EventId.make(`event:${name}:delivery-message`),
                type: "message.updated",
                threadId,
                runId: deliveryRunId,
                occurredAt: now,
                payload: {
                  id: messageId,
                  threadId,
                  runId: deliveryRunId,
                  nodeId: null,
                  role: "user",
                  text: `Delegated task ${taskId} reached a terminal state.`,
                  attachments: [],
                  streaming: false,
                  createdBy: "agent",
                  creationSource: "server",
                  createdAt: now,
                  updatedAt: now,
                  delegatedCompletion: { parentRunId: runId, generation: 1, taskIds: [taskId] },
                },
              },
              runEvent({
                threadId,
                runId: deliveryRunId,
                ordinal: 2,
                status: "cancelled",
                now,
                providerThreadId: parentProviderThreadId(threadId),
                userMessageId: messageId,
              }),
            ],
            effects: continuationPending
              ? [
                  {
                    id: `effect:restart-continuation:${deliveryRunId}`,
                    commandId: reconcileCommandId(name),
                    threadId,
                    request: { type: "provider-runtime.continue", sourceRunId: deliveryRunId },
                  },
                ]
              : [],
          });
          return { threadId, runId, taskId };
        });
      const cut = yield* seed("delivery-cut", false);
      const resumed = yield* seed("delivery-resumed", true);

      yield* orchestrator.recoverDelegatedTasks;

      for (const seeded of [cut, resumed]) {
        const projection = yield* orchestrator.getThreadProjection(seeded.threadId);
        assert.deepEqual(
          projection.subagents.find((row) => row.id === seeded.taskId)?.completionDelivery?.state,
          "claimed",
        );
        const delivery = projection.runs.find((row) => row.id === seeded.runId)?.delegatedCompletion
          ?.delivery;
        assert.equal(delivery?.generation, 2);
        assert.deepEqual(delivery?.taskIds, [seeded.taskId]);
      }
    }),
  );

  it.effect("settles a cancelled child whose held wakes wait behind it", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:held-wake-parent");
      const projectId = ProjectId.make("project:held-wake-parent");
      const runId = RunId.make("run:held-wake-parent");
      const rootNodeId = NodeId.make("node:held-wake-parent-root");
      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: NodeId.make("node:held-wake-parent-settled"),
        deliveryState: "delivered",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId: threadId,
        projectId,
        parentRunId: runId,
        rootNodeId,
        name: "held-wake-child",
        completionWake: "always",
        continuationPending: false,
        now,
      });
      const held = runEvent({
        threadId: child.childThreadId,
        runId: RunId.make("run:held-wake-child:2"),
        ordinal: 2,
        status: "queued",
        now,
      });
      yield* eventSink.write({
        commandId: CommandId.make("command:held-wake-child:held"),
        events: [
          {
            ...held,
            payload: { ...held.payload, startedAt: null, completedAt: null, queueHeld: true },
          },
        ],
      });

      yield* orchestrator.recoverDelegatedTasks;

      const recovered = yield* orchestrator.getThreadProjection(threadId);
      const task = recovered.subagents.find((row) => row.id === child.taskId);
      assert.equal(task?.status, "cancelled");
      assert.isNotNull(task?.result ?? null);
      assert.isTrue(
        recovered.contextTransfers.some(
          (transfer) =>
            transfer.type === "subagent_result" && transfer.sourceThreadId === child.childThreadId,
        ),
      );
      assert.isFalse(yield* orchestrator.delegatedTaskResultPending(child.childThreadId));
      const childProjection = yield* orchestrator.getThreadProjection(child.childThreadId);
      assert.deepEqual(
        childProjection.runs.map((run) => [run.status, run.queueHeld ?? false]),
        [
          ["cancelled", false],
          ["queued", true],
        ],
      );
    }),
  );

  it.effect("settles a child whose provider failure holds its queued wakes", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:failed-hold-parent");
      const projectId = ProjectId.make("project:failed-hold-parent");
      const runId = RunId.make("run:failed-hold-parent");
      const rootNodeId = NodeId.make("node:failed-hold-parent-root");
      yield* seedParentWithTerminalTask({
        threadId,
        projectId,
        runId,
        rootNodeId,
        taskId: NodeId.make("node:failed-hold-parent-settled"),
        deliveryState: "delivered",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId: threadId,
        projectId,
        parentRunId: runId,
        rootNodeId,
        name: "failed-hold-child",
        completionWake: "always",
        continuationPending: false,
        now,
      });
      const activeRun = runEvent({
        threadId: child.childThreadId,
        runId: RunId.make("run:failed-hold-child:2"),
        ordinal: 2,
        status: "running",
        now,
      });
      const queued = runEvent({
        threadId: child.childThreadId,
        runId: RunId.make("run:failed-hold-child:3"),
        ordinal: 3,
        status: "queued",
        now,
      });
      yield* eventSink.write({
        commandId: CommandId.make("command:failed-hold-child:resumed"),
        events: [
          activeRun,
          { ...queued, payload: { ...queued.payload, startedAt: null, completedAt: null } },
        ],
      });
      const afterSequence = yield* eventSink.latestSequence();
      const errorItemId = TurnItemId.make("turn-item:failed-hold-child:error");
      yield* eventSink.write({
        commandId: CommandId.make("command:failed-hold-child:failed"),
        events: [
          {
            id: EventId.make("event:failed-hold-child:error"),
            type: "turn-item.updated",
            threadId: child.childThreadId,
            runId: activeRun.runId,
            providerInstanceId: modelSelection.instanceId,
            occurredAt: now,
            payload: {
              id: errorItemId,
              type: "error",
              threadId: child.childThreadId,
              runId: activeRun.runId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 1,
              status: "failed",
              title: "Provider failure",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              failure: {
                class: "provider_error",
                message: "Provider failed.",
                code: "provider_failed",
                retryable: null,
              },
            },
          },
          {
            ...activeRun,
            id: EventId.make("event:failed-hold-child:failed"),
            payload: { ...activeRun.payload, status: "failed", completedAt: now },
          },
        ],
      });

      const settled = yield* eventSink
        .stream({ afterSequence, eventType: "subagent.updated" })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "subagent.updated" && stored.event.payload.id === child.taskId,
          ),
          Stream.take(1),
          Stream.runHead,
        );
      assert.isTrue(settled._tag === "Some");
      const recovered = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(recovered.subagents.find((row) => row.id === child.taskId)?.status, "failed");
      const childProjection = yield* orchestrator.getThreadProjection(child.childThreadId);
      assert.deepEqual(
        childProjection.runs.map((run) => [run.status, run.queueHeld ?? false]),
        [
          ["cancelled", false],
          ["failed", false],
          ["queued", true],
        ],
      );
    }),
  );

  it.effect(
    "recovers an unpublished child failure after its completion delivery was disposed",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:unpublished-failure-parent");
        const projectId = ProjectId.make("project:unpublished-failure-parent");
        const runId = RunId.make("run:unpublished-failure-parent");
        const rootNodeId = NodeId.make("node:unpublished-failure-parent-root");
        yield* seedParentWithTerminalTask({
          threadId,
          projectId,
          runId,
          rootNodeId,
          taskId: NodeId.make("node:unpublished-failure-parent-settled"),
          deliveryState: "delivered",
          now,
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId: threadId,
          projectId,
          parentRunId: runId,
          rootNodeId,
          name: "unpublished-failure-child",
          completionWake: "always",
          continuationPending: false,
          now,
        });
        // Skip the live terminal listener to model a committed failure whose
        // publication was interrupted. task_cancel then disposed its delivery.
        yield* eventSink.write({
          commandId: reconcileCommandId("unpublished-failure"),
          events: [
            runEvent({
              threadId: child.childThreadId,
              runId: child.childRunId,
              ordinal: 1,
              status: "failed",
              now,
            }),
          ],
        });
        yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.dispose",
          commandId: CommandId.make("command:unpublished-failure-dispose"),
          parentThreadId: threadId,
          taskId: child.taskId,
        });
        yield* orchestrator.recoverDelegatedTasks;
        const recovered = yield* orchestrator.getThreadProjection(threadId);
        const task = recovered.subagents.find((row) => row.id === child.taskId);
        assert.equal(task?.status, "failed");
        assert.equal(task?.result, "Child task ended with status failed.");
        assert.equal(task?.completionDelivery?.state, "disposed");
        assert.lengthOf(recovered.runs, 1);
        assert.lengthOf(
          recovered.contextTransfers.filter((transfer) => transfer.type === "subagent_result"),
          1,
        );
        yield* orchestrator.recoverDelegatedTasks;
        assert.deepEqual(yield* orchestrator.getThreadProjection(threadId), recovered);
      }),
  );

  it.effect.each([false, true])(
    "wakes the parent for a settled_only result with a running continuation: %s",
    (runningContinuation) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const suffix = runningContinuation ? "running" : "idle";
        const threadId = ThreadId.make(`thread:settled-only-restart-${suffix}`);
        const projectId = ProjectId.make(`project:settled-only-restart-${suffix}`);
        const runId = RunId.make(`run:settled-only-restart-${suffix}`);
        const rootNodeId = NodeId.make(`node:settled-only-restart-root-${suffix}`);
        yield* seedParentWithTerminalTask({
          threadId,
          projectId,
          runId,
          rootNodeId,
          taskId: NodeId.make(`node:settled-only-restart-settled-${suffix}`),
          deliveryState: "delivered",
          now,
        });
        yield* eventSink.write({
          commandId: reconcileCommandId(`settled-only-restart-${suffix}`),
          events: [
            runEvent({
              threadId,
              runId,
              ordinal: 1,
              status: "cancelled",
              now,
              providerThreadId: parentProviderThreadId(threadId),
              userMessageId: MessageId.make(`message:seed-user:${threadId}`),
              delegatedCompletion: { disposition: "open", nextGeneration: 2, delivery: null },
            }),
            ...(runningContinuation
              ? [
                  runEvent({
                    threadId,
                    runId: RunId.make(`run:settled-only-restart:continuation-${suffix}`),
                    ordinal: 2,
                    status: "running",
                    now,
                    providerThreadId: parentProviderThreadId(threadId),
                  }),
                ]
              : []),
          ],
        });
        const child = yield* seedRestartCancelledChild({
          parentThreadId: threadId,
          projectId,
          parentRunId: runId,
          rootNodeId,
          name: `settled-only-restart-child-${suffix}`,
          completionWake: "settled_only",
          continuationPending: false,
          now,
        });

        yield* orchestrator.dispatch({
          type: "delegated_task.completion-delivery.acknowledge",
          commandId: CommandId.make(`command:settled-only-late-read-${suffix}`),
          parentThreadId: threadId,
          taskId: child.taskId,
          observedByRunId: null,
        });
        yield* orchestrator.recoverDelegatedTasks;

        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          projection.subagents.find((row) => row.id === child.taskId)?.completionDelivery?.state,
          "claimed",
        );
        assert.deepEqual(
          projection.runs.find((row) => row.id === runId)?.delegatedCompletion?.delivery?.taskIds,
          [child.taskId],
        );
      }),
  );

  it.effect.each(["a background command", "a nested subagent"] as const)(
    "finalizes a child whose run ended before %s settled",
    (blocker) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const key = blocker === "a background command" ? "command" : "nested";
        const threadId = ThreadId.make(`late-settle-parent-${key}`);
        const runId = RunId.make(`late-settle-parent-run-${key}`);
        const rootNodeId = NodeId.make(`late-settle-parent-root-${key}`);
        yield* seedParentWithTerminalTask({
          threadId,
          projectId: ProjectId.make(`late-settle-project-${key}`),
          runId,
          rootNodeId,
          taskId: NodeId.make(`late-settle-seed-task-${key}`),
          deliveryState: "acknowledged",
          now,
        });
        // A delegated child with a running task on the parent and a running run of its own.
        const delegate = (name: string) =>
          Effect.gen(function* () {
            const taskId = NodeId.make(`node:late-settle-${key}-${name}`);
            const childThreadId = ThreadId.make(`thread:late-settle-${key}-${name}`);
            const run = runEvent({
              threadId: childThreadId,
              runId: RunId.make(`run:late-settle-${key}-${name}`),
              ordinal: 1,
              status: "running",
              now,
            });
            yield* sink.write({
              events: [
                {
                  id: EventId.make(`event:late-settle-${key}-${name}:thread`),
                  type: "thread.created",
                  threadId: childThreadId,
                  occurredAt: now,
                  payload: {
                    createdBy: "agent",
                    creationSource: "server",
                    id: childThreadId,
                    projectId: ProjectId.make(`late-settle-project-${key}`),
                    title: name,
                    providerInstanceId: modelSelection.instanceId,
                    modelSelection,
                    runtimeMode: "full-access",
                    interactionMode: "default",
                    branch: null,
                    worktreePath: null,
                    activeProviderThreadId: null,
                    lineage: {
                      parentThreadId: threadId,
                      relationshipToParent: "subagent",
                      rootThreadId: threadId,
                    },
                    forkedFrom: { type: "node", nodeId: taskId },
                    createdAt: now,
                    updatedAt: now,
                    archivedAt: null,
                    settledOverride: null,
                    settledAt: null,
                    lastVisitedAt: null,
                    deletedAt: null,
                  },
                },
                {
                  id: EventId.make(`event:late-settle-${key}-${name}:task`),
                  type: "subagent.updated",
                  threadId,
                  runId,
                  nodeId: taskId,
                  driver,
                  providerInstanceId: modelSelection.instanceId,
                  occurredAt: now,
                  payload: {
                    id: taskId,
                    threadId,
                    runId,
                    parentNodeId: rootNodeId,
                    origin: "app_owned",
                    createdBy: "agent",
                    driver,
                    providerInstanceId: modelSelection.instanceId,
                    providerThreadId: null,
                    childThreadId,
                    nativeTaskRef: null,
                    prompt: `Run ${name}.`,
                    title: null,
                    model: null,
                    completionWake: "always",
                    status: "running",
                    result: null,
                    startedAt: now,
                    completedAt: null,
                    updatedAt: now,
                  },
                },
                run,
              ],
            });
            return { task: { id: taskId }, childThreadId, run: run.payload };
          });
        const settled = (taskId: NodeId, afterSequence: number) =>
          sink.stream({ afterSequence, eventType: "subagent.updated" }).pipe(
            Stream.filter(
              (stored) =>
                stored.event.type === "subagent.updated" &&
                stored.event.payload.id === taskId &&
                stored.event.payload.status === "completed",
            ),
            Stream.take(1),
            Stream.runDrain,
          );
        const blocked = yield* delegate("blocked");
        const barrier = yield* delegate("barrier");
        const providerThread = {
          id: ProviderThreadId.make(`provider-thread:late-settle-child-${key}`),
          driver,
          providerInstanceId: modelSelection.instanceId,
          providerSessionId: null,
          appThreadId: blocked.childThreadId,
          ownerNodeId: null,
          nativeThreadRef: null,
          nativeConversationHeadRef: null,
          status: "idle" as const,
          firstRunOrdinal: 1,
          lastRunOrdinal: 1,
          handoffIds: [],
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
        };
        const nested = {
          id: NodeId.make(`late-settle-nested-${key}`),
          threadId: blocked.childThreadId,
          runId: blocked.run.id,
          parentNodeId: NodeId.make(`late-settle-child-root-${key}`),
          origin: "provider_native" as const,
          createdBy: "agent" as const,
          driver,
          providerInstanceId: modelSelection.instanceId,
          providerThreadId: null,
          childThreadId: null,
          nativeTaskRef: null,
          prompt: "Nested work",
          title: null,
          model: null,
          status: "running" as const,
          result: null,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        };
        const blockerEvent = (open: boolean) =>
          blocker === "a background command"
            ? {
                id: EventId.make(`event:late-settle-roster-${key}-${open}`),
                type: "provider-thread.updated" as const,
                threadId: blocked.childThreadId,
                driver,
                providerInstanceId: modelSelection.instanceId,
                occurredAt: now,
                payload: {
                  ...providerThread,
                  pendingBackgroundTasks: [
                    ...(open
                      ? [{ taskId: "sleep-900", kind: "command" as const, awaited: true as const }]
                      : []),
                    { taskId: "log-watcher", kind: "monitor" as const },
                  ],
                },
              }
            : {
                id: EventId.make(`event:late-settle-nested-${key}-${open}`),
                type: "subagent.updated" as const,
                threadId: blocked.childThreadId,
                runId: blocked.run.id,
                nodeId: nested.id,
                driver,
                providerInstanceId: modelSelection.instanceId,
                occurredAt: now,
                payload: open
                  ? nested
                  : { ...nested, status: "completed" as const, result: "done", completedAt: now },
              };
        const ended = (child: typeof blocked) => ({
          ...runEvent({
            threadId: child.childThreadId,
            runId: child.run.id,
            ordinal: child.run.ordinal,
            status: "completed",
            now,
          }),
          payload: { ...child.run, status: "completed" as const, startedAt: now, completedAt: now },
        });

        const beforeEnd = yield* sink.latestSequence();
        yield* sink.write({ events: [blockerEvent(true)] });
        yield* sink.write({ events: [ended(blocked)] });
        yield* sink.write({ events: [ended(barrier)] });
        // Run updates are handled in order, so the barrier settling means the blocked child's
        // run end was handled too, while its work still ran.
        yield* settled(barrier.task.id, beforeEnd);
        assert.equal(
          (yield* orchestrator.getThreadProjection(threadId)).subagents.find(
            (task) => task.id === blocked.task.id,
          )?.status,
          "running",
        );

        const beforeSettle = yield* sink.latestSequence();
        yield* sink.write({ events: [blockerEvent(false)] });
        yield* settled(blocked.task.id, beforeSettle);
        const finished = (yield* orchestrator.getThreadProjection(threadId)).subagents.find(
          (task) => task.id === blocked.task.id,
        );
        assert.equal(finished?.status, "completed");
        assert.notEqual(finished?.completionDelivery?.state, "disposed");
      }),
  );
});

/** A thread in an existing project with one finished run, so it can take subagents. */
const seedThreadWithRun = (input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly now: DateTime.Utc;
}) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:seed-create:${input.threadId}`),
      threadId: input.threadId,
      projectId: input.projectId,
      title: String(input.threadId),
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    const run = runEvent({
      threadId: input.threadId,
      runId: RunId.make(`run:${input.threadId}`),
      ordinal: 1,
      status: "completed",
      now: input.now,
    });
    yield* eventSink.write({
      commandId: CommandId.make(`command:seed-run:${input.threadId}`),
      events: [
        {
          ...run,
          payload: { ...run.payload, rootNodeId: NodeId.make(`node:root:${input.threadId}`) },
        },
      ],
    });
  });

/** A child thread record under `parentThreadId`, written directly. */
const seedChildThread = (input: {
  readonly threadId: ThreadId;
  readonly parentThreadId: ThreadId;
  readonly rootThreadId: ThreadId;
  readonly projectId: ProjectId;
  readonly sideChat?: boolean;
  readonly now: DateTime.Utc;
}) =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    yield* eventSink.write({
      commandId: CommandId.make(`command:seed-child-thread:${input.threadId}`),
      events: [
        {
          id: EventId.make(`event:seed-child-thread:${input.threadId}`),
          type: "thread.created",
          threadId: input.threadId,
          occurredAt: input.now,
          payload: {
            createdBy: "agent",
            creationSource: "server",
            id: input.threadId,
            projectId: input.projectId,
            title: String(input.threadId),
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: {
              parentThreadId: input.parentThreadId,
              relationshipToParent: input.sideChat === true ? "fork" : "subagent",
              rootThreadId: input.rootThreadId,
              ...(input.sideChat === true ? { sideChat: true } : {}),
            },
            forkedFrom:
              input.sideChat === true
                ? null
                : { type: "node", nodeId: NodeId.make(`node:${input.threadId}`) },
            createdAt: input.now,
            updatedAt: input.now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        },
      ],
    });
  });

it.layer(Layer.merge(layerTest, ProviderContinuationRequests.layer))("thread moves", (it) => {
  const move = (name: string, threadId: ThreadId, parentThreadId: ThreadId | null) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      return yield* orchestrator.dispatch({
        type: "thread.move",
        commandId: CommandId.make(`command:move:${name}`),
        threadId,
        parentThreadId,
      });
    });
  const refusal = (name: string, threadId: ThreadId, parentThreadId: ThreadId | null) =>
    move(name, threadId, parentThreadId).pipe(
      Effect.flip,
      Effect.map((error) => String("cause" in error ? error.cause : error)),
    );

  it.effect("refuses cycles, other projects, side chats and moves that change nothing", () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:move-rules");
      const parent = ThreadId.make("thread:move-rules-parent");
      const child = ThreadId.make("thread:move-rules-child");
      const grandchild = ThreadId.make("thread:move-rules-grandchild");
      const sideChat = ThreadId.make("thread:move-rules-side-chat");
      const elsewhere = ThreadId.make("thread:move-rules-elsewhere");
      yield* seedParentWithTerminalTask({
        threadId: parent,
        projectId,
        runId: RunId.make("run:move-rules-parent"),
        rootNodeId: NodeId.make("node:move-rules-parent"),
        taskId: NodeId.make("node:move-rules-seed"),
        deliveryState: "acknowledged",
        parentRunStatus: "completed",
        now,
      });
      yield* seedChildThread({
        threadId: child,
        parentThreadId: parent,
        rootThreadId: parent,
        projectId,
        now,
      });
      yield* seedChildThread({
        threadId: grandchild,
        parentThreadId: child,
        rootThreadId: parent,
        projectId,
        now,
      });
      yield* seedChildThread({
        threadId: sideChat,
        parentThreadId: parent,
        rootThreadId: parent,
        projectId,
        sideChat: true,
        now,
      });
      yield* seedParentWithTerminalTask({
        threadId: elsewhere,
        projectId: ProjectId.make("project:move-rules-elsewhere"),
        runId: RunId.make("run:move-rules-elsewhere"),
        rootNodeId: NodeId.make("node:move-rules-elsewhere"),
        taskId: NodeId.make("node:move-rules-elsewhere-seed"),
        deliveryState: "acknowledged",
        parentRunStatus: "completed",
        now,
      });

      assert.include(yield* refusal("self", parent, parent), "cannot move under itself");
      assert.include(yield* refusal("cycle", child, grandchild), "its own descendant");
      assert.include(yield* refusal("cycle-root", parent, grandchild), "its own descendant");
      assert.include(yield* refusal("other-project", child, elsewhere), "another project");
      assert.include(yield* refusal("side-chat", sideChat, null), "side chat");
      assert.include(yield* refusal("under-side-chat", child, sideChat), "cannot delegate");
      assert.include(yield* refusal("same-parent", child, parent), "already under");
      assert.include(yield* refusal("root-to-root", parent, null), "already a top-level");
    }),
  );

  it.effect("refuses while the child still owes its parent a result", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:move-owed");
      const parentThreadId = ThreadId.make("thread:move-owed-parent");
      const parentRunId = RunId.make("run:move-owed-parent");
      const rootNodeId = NodeId.make("node:move-owed-parent");
      yield* seedParentWithTerminalTask({
        threadId: parentThreadId,
        projectId,
        runId: parentRunId,
        rootNodeId,
        taskId: NodeId.make("node:move-owed-seed"),
        deliveryState: "acknowledged",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId,
        projectId,
        parentRunId,
        rootNodeId,
        name: "move-owed-child",
        completionWake: "always",
        continuationPending: false,
        runStatus: "completed",
        now,
      });
      // The task still runs until its result reaches the parent.
      assert.include(yield* refusal("owed", child.childThreadId, null), "still owes");
      yield* orchestrator.recoverDelegatedTasks;
      const delivered = yield* orchestrator.getThreadProjection(parentThreadId);
      assert.equal(
        delivered.subagents.find((task) => task.id === child.taskId)?.status,
        "completed",
      );
      yield* move("owed-delivered", child.childThreadId, null);
      const moved = yield* orchestrator.getThreadProjection(child.childThreadId);
      assert.deepEqual(moved.thread.lineage, {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: child.childThreadId,
      });
    }),
  );

  it.effect.each(["pending", "claimed", "delivered"] as const)(
    "moves a child whose finished task's completion is %s only once it reached the parent",
    (state) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const projectId = ProjectId.make(`project:move-delivery-${state}`);
        const parent = ThreadId.make(`thread:move-delivery-parent-${state}`);
        const child = ThreadId.make(`thread:move-delivery-child-${state}`);
        const runId = RunId.make(`run:move-delivery-${state}`);
        const rootNodeId = NodeId.make(`node:move-delivery-${state}`);
        const taskId = NodeId.make(`node:${child}`);
        yield* seedParentWithTerminalTask({
          threadId: parent,
          projectId,
          runId,
          rootNodeId,
          taskId: NodeId.make(`node:move-delivery-seed-${state}`),
          deliveryState: "acknowledged",
          now,
        });
        yield* seedChildThread({
          threadId: child,
          parentThreadId: parent,
          rootThreadId: parent,
          projectId,
          now,
        });
        // The task finished with a result, but the parent's agent may not have it yet.
        yield* eventSink.write({
          commandId: CommandId.make(`command:move-delivery-task-${state}`),
          events: [
            {
              id: EventId.make(`event:move-delivery-task-${state}`),
              type: "subagent.updated",
              threadId: parent,
              runId,
              nodeId: taskId,
              driver,
              providerInstanceId: modelSelection.instanceId,
              occurredAt: now,
              payload: {
                id: taskId,
                threadId: parent,
                runId,
                parentNodeId: rootNodeId,
                origin: "app_owned",
                createdBy: "agent",
                driver,
                providerInstanceId: modelSelection.instanceId,
                providerThreadId: null,
                childThreadId: child,
                nativeTaskRef: null,
                prompt: "Do it.",
                title: null,
                model: null,
                completionDelivery: { state, observedByRunId: null },
                status: "completed",
                result: "done",
                startedAt: now,
                completedAt: now,
                updatedAt: now,
              },
            },
          ],
        });
        if (state === "delivered") {
          yield* move(`delivery-${state}`, child, null);
          assert.isNull(
            (yield* orchestrator.getThreadProjection(child)).thread.lineage.parentThreadId,
          );
        } else {
          assert.include(yield* refusal(`delivery-${state}`, child, null), "still owes");
        }
      }),
  );

  it.effect("runs reciprocal moves one at a time, refusing the second as a cycle", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:move-reciprocal");
      const first = ThreadId.make("thread:move-reciprocal-a");
      const second = ThreadId.make("thread:move-reciprocal-b");
      yield* seedParentWithTerminalTask({
        threadId: first,
        projectId,
        runId: RunId.make("run:move-reciprocal-a"),
        rootNodeId: NodeId.make("node:move-reciprocal-a"),
        taskId: NodeId.make("node:move-reciprocal-seed"),
        deliveryState: "acknowledged",
        parentRunStatus: "completed",
        now,
      });
      yield* seedThreadWithRun({ threadId: second, projectId, now });
      // Unrelated when both start, so each cycle check alone would pass. Holding the first
      // thread's lock lines the two moves up on each other's locks, the order that deadlocked.
      const locks = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const release = yield* Deferred.make<void>();
      const holder = yield* locks.withLock(first, Deferred.await(release)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const secondUnderFirst = yield* refusal("reciprocal-b", second, first).pipe(
        Effect.option,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      const firstUnderSecond = yield* refusal("reciprocal-a", first, second).pipe(
        Effect.option,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      const outcomes = [yield* Fiber.join(secondUnderFirst), yield* Fiber.join(firstUnderSecond)];
      const refused = outcomes.flatMap((outcome) =>
        outcome._tag === "Some" ? [outcome.value] : [],
      );
      assert.lengthOf(refused, 1);
      assert.include(refused[0], "its own descendant");
      const lineages = yield* Effect.forEach([first, second], (id) =>
        orchestrator.getThreadProjection(id).pipe(Effect.map((row) => row.thread.lineage)),
      );
      assert.lengthOf(
        lineages.filter((lineage) => lineage.relationshipToParent === "subagent"),
        1,
      );
    }),
  );

  it.effect("moves a subtree to root and under a new parent, which then gets its results", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:move-trip");
      const parentThreadId = ThreadId.make("thread:move-trip-parent");
      const parentRunId = RunId.make("run:move-trip-parent");
      const rootNodeId = NodeId.make("node:move-trip-parent");
      const newParentId = ThreadId.make("thread:move-trip-new-parent");
      const grandchild = ThreadId.make("thread:move-trip-grandchild");
      yield* seedParentWithTerminalTask({
        threadId: parentThreadId,
        projectId,
        runId: parentRunId,
        rootNodeId,
        taskId: NodeId.make("node:move-trip-seed"),
        deliveryState: "acknowledged",
        now,
      });
      const child = yield* seedRestartCancelledChild({
        parentThreadId,
        projectId,
        parentRunId,
        rootNodeId,
        name: "move-trip-child",
        completionWake: "always",
        continuationPending: false,
        runStatus: "completed",
        now,
      });
      yield* seedChildThread({
        threadId: grandchild,
        parentThreadId: child.childThreadId,
        rootThreadId: parentThreadId,
        projectId,
        now,
      });
      yield* seedThreadWithRun({ threadId: newParentId, projectId, now });
      yield* orchestrator.recoverDelegatedTasks;
      yield* orchestrator.dispatch({
        type: "thread.pin",
        commandId: CommandId.make("command:move-trip:pin"),
        threadId: child.childThreadId,
      });
      const oldParentTasks = (yield* orchestrator.getThreadProjection(parentThreadId)).subagents
        .length;

      // To root: a top-level thread that keeps its pin; its child follows.
      yield* move("trip-root", child.childThreadId, null);
      const atRoot = yield* orchestrator.getThreadProjection(child.childThreadId);
      assert.deepEqual(atRoot.thread.lineage, {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: child.childThreadId,
      });
      assert.isNotNull(atRoot.thread.pinnedAt ?? null);
      const grandchildAtRoot = yield* orchestrator.getThreadProjection(grandchild);
      assert.equal(grandchildAtRoot.thread.lineage.parentThreadId, child.childThreadId);
      assert.equal(grandchildAtRoot.thread.lineage.rootThreadId, child.childThreadId);

      // Under the new parent: a subagent again, answering to it.
      yield* move("trip-under", child.childThreadId, newParentId);
      const under = yield* orchestrator.getThreadProjection(child.childThreadId);
      assert.equal(under.thread.lineage.parentThreadId, newParentId);
      assert.equal(under.thread.lineage.relationshipToParent, "subagent");
      assert.equal(under.thread.lineage.rootThreadId, newParentId);
      assert.equal(
        (yield* orchestrator.getThreadProjection(grandchild)).thread.lineage.rootThreadId,
        newParentId,
      );
      // Work from before the move is not handed to the new parent, even by recovery.
      yield* orchestrator.recoverDelegatedTasks;
      const adopted = yield* orchestrator.getThreadProjection(newParentId);
      const adoptedTask = adopted.subagents.find(
        (task) => task.childThreadId === child.childThreadId,
      );
      assert.equal(adoptedTask?.result, "");
      assert.lengthOf(
        adopted.contextTransfers.filter(
          (transfer) =>
            transfer.type === "subagent_result" && transfer.sourceThreadId === child.childThreadId,
        ),
        1,
      );

      // A follow-up from the new parent reports back to it, not to the old parent.
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "agent",
        creationSource: "mcp",
        commandId: CommandId.make("command:move-trip:followup"),
        threadId: child.childThreadId,
        senderThreadId: newParentId,
        messageId: MessageId.make("message:move-trip:followup"),
        text: "One more thing",
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
      });
      const followupRun = (yield* orchestrator.getThreadProjection(child.childThreadId)).runs.find(
        (run) => run.userMessageId === MessageId.make("message:move-trip:followup"),
      )!;
      const followupTaskId = followupRun.delegatedTaskId;
      assert.isDefined(followupTaskId);
      const endedSequence = yield* eventSink.latestSequence();
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:move-trip-followup-ended"),
            type: "run.updated",
            threadId: child.childThreadId,
            runId: followupRun.id,
            occurredAt: now,
            payload: { ...followupRun, status: "completed", startedAt: now, completedAt: now },
          },
        ],
      });
      yield* eventSink.stream({ afterSequence: endedSequence, eventType: "subagent.updated" }).pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "subagent.updated" &&
            stored.event.payload.id === followupTaskId &&
            stored.event.payload.status === "completed",
        ),
        Stream.take(1),
        Stream.runHead,
      );
      const reported = yield* orchestrator.getThreadProjection(newParentId);
      assert.equal(
        reported.subagents.find((task) => task.id === followupTaskId)?.status,
        "completed",
      );
      assert.isTrue(
        reported.contextTransfers.some(
          (transfer) =>
            transfer.type === "subagent_result" &&
            transfer.sourceThreadId === child.childThreadId &&
            transfer.sourcePoint.runId === followupRun.id,
        ),
      );
      const oldParent = yield* orchestrator.getThreadProjection(parentThreadId);
      assert.lengthOf(oldParent.subagents, oldParentTasks);
      assert.isFalse(
        oldParent.contextTransfers.some(
          (transfer) => transfer.sourcePoint.runId === followupRun.id,
        ),
      );
    }),
  );
});
