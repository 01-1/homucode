import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

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
import {
  AUTOREVIEW_BATCH_MESSAGE_PREFIX,
  AUTOREVIEW_FINDINGS_MESSAGE_PREFIX,
  findingsSection,
  renderFindingsMessage,
} from "./autoreviewBatch.ts";
import * as AutoreviewService from "./AutoreviewService.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as RuntimeLayer from "./runtimeLayer.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ProviderTurnStartServiceTestkit from "./ProviderTurnStartService.testkit.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const layerPlatformTest = Layer.merge(
  Layer.mergeAll(NodeServices.layer, NodeCrypto.layer),
  Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    resolveLink: () => Effect.die("unused title link"),
  }),
);

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-orchestration-v2-autoreview-",
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
  openSession: () => Effect.die("sessions are not used by autoreview tests"),
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

const itemBase = (input: {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly id: string;
  readonly ordinal: number;
  readonly now: DateTime.Utc;
}) => ({
  id: TurnItemId.make(`turn-item:${input.id}`),
  threadId: input.threadId,
  runId: input.runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: input.ordinal,
  status: "completed" as const,
  title: null,
  startedAt: input.now,
  completedAt: input.now,
  updatedAt: input.now,
});

const assistantItem = (
  input: Parameters<typeof itemBase>[0] & { readonly text: string },
): OrchestrationV2TurnItem => ({
  ...itemBase(input),
  type: "assistant_message",
  messageId: MessageId.make(`message:${input.id}`),
  text: input.text,
  streaming: false,
});

let eventCounter = 0;
const itemEvent = (item: OrchestrationV2TurnItem): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:item:${item.id}:${++eventCounter}`),
  type: "turn-item.updated",
  threadId: item.threadId,
  ...(item.runId === null ? {} : { runId: item.runId }),
  providerInstanceId: modelSelection.instanceId,
  occurredAt: item.updatedAt,
  payload: item,
});

/** A thread whose first run is still working, with a request, a reply and an edit. */
const seedReviewedThread = (name: string) =>
  Effect.gen(function* () {
    const projects = yield* ProjectService.ProjectService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const projectId = ProjectId.make(`project:${name}`);
    const threadId = ThreadId.make(`thread:${name}`);
    const runId = RunId.make(`run:${name}`);
    const rootNodeId = NodeId.make(`node:${name}`);
    const providerThreadId = ProviderThreadId.make(`provider-thread:${name}`);
    yield* projects.create({
      commandId: CommandId.make(`command:seed-project:${name}`),
      projectId,
      title: "Autoreview",
      workspaceRoot: `/workspace/${name}`,
    });
    yield* orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:seed-create:${name}`),
      threadId,
      projectId,
      title: "Reviewed work",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    const run: OrchestrationV2Run = {
      id: runId,
      threadId,
      ordinal: 1,
      providerInstanceId: modelSelection.instanceId,
      modelSelection,
      providerThreadId,
      userMessageId: MessageId.make(`message:${name}:request`),
      rootNodeId,
      activeAttemptId: null,
      status: "running",
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    };
    const base = { threadId, runId, now };
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      {
        ...itemBase({ ...base, id: `${name}:request`, ordinal: 1 }),
        type: "user_message",
        messageId: run.userMessageId,
        createdBy: "user",
        creationSource: "web",
        inputIntent: "turn_start",
        text: "Make parse() reject empty input.",
        attachments: [],
      },
      assistantItem({ ...base, id: `${name}:reply`, ordinal: 2, text: "Editing parse.ts now." }),
      {
        ...itemBase({ ...base, id: `${name}:edit`, ordinal: 3 }),
        type: "file_change",
        fileName: "src/parse.ts",
        diffStr: "@@ -1 +1 @@\n-  return value;\n+  if (!value) throw new Error('empty');",
      },
    ];
    yield* eventSink.write({
      commandId: CommandId.make(`command:seed-projection:${name}`),
      events: [
        {
          id: EventId.make(`event:seed-provider-thread:${name}`),
          type: "provider-thread.updated",
          threadId,
          driver,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId: modelSelection.instanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: rootNodeId,
            nativeThreadRef: { driver, nativeId: `native:${name}`, strength: "strong" },
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          id: EventId.make(`event:seed-run:${name}`),
          type: "run.updated",
          threadId,
          runId,
          nodeId: rootNodeId,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: now,
          payload: run,
        },
        {
          id: EventId.make(`event:seed-node:${name}`),
          type: "node.updated",
          threadId,
          runId,
          nodeId: rootNodeId,
          occurredAt: now,
          payload: {
            id: rootNodeId,
            threadId,
            runId,
            parentNodeId: null,
            rootNodeId,
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
        ...items.map(itemEvent),
      ],
    });
    return { threadId, runId, now };
  });

const reviewerModel = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6.1-sol",
  options: [{ id: "reasoningEffort", value: "xhigh" }],
} satisfies ModelSelection;

const attachReviewer = (
  service: AutoreviewService.AutoreviewService["Service"],
  threadId: ThreadId,
  name: string,
  brief?: string,
  minBatchChars?: number,
  wakeOnUserMessage?: boolean,
) =>
  service.attach({
    ...(minBatchChars === undefined ? {} : { minBatchChars }),
    ...(wakeOnUserMessage === undefined ? {} : { wakeOnUserMessage }),
    commandId: CommandId.make(`command:autoreview-attach:${name}`),
    threadId,
    modelSelection: reviewerModel,
    runtimeMode: "full-access",
    interactionMode: "default",
    ...(brief === undefined ? {} : { brief }),
    createdBy: "agent",
    creationSource: "mcp",
  });

/** Ends the reviewer's newest run with `review` as its final reply and returns that event. */
const finishReview = (reviewerThreadId: ThreadId, review: string, name: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const run = (yield* orchestrator.getThreadProjection(reviewerThreadId)).runs.toSorted(
      (left, right) => right.ordinal - left.ordinal,
    )[0]!;
    const reply = assistantItem({
      threadId: reviewerThreadId,
      runId: run.id,
      id: `${name}:review`,
      ordinal: 100 + run.ordinal,
      now,
      text: review,
    });
    const ended: OrchestrationV2DomainEvent = {
      id: EventId.make(`event:${name}:review-ended`),
      type: "run.updated",
      threadId: reviewerThreadId,
      runId: run.id,
      providerInstanceId: reviewerModel.instanceId,
      occurredAt: now,
      payload: { ...run, status: "completed", startedAt: now, completedAt: now },
    };
    yield* eventSink.write({ events: [itemEvent(reply), ended] });
    return { run, ended };
  });

const messagesTo = (threadId: ThreadId, prefix: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    return projection.messages.filter((message) => message.id.startsWith(prefix));
  });

type DispatchCommand = Parameters<Orchestrator.OrchestratorV2["Service"]["dispatch"]>[0];

/** The orchestrator, except that steering always succeeds and is only recorded. */
const steeringPort = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  steered: Array<DispatchCommand>,
): AutoreviewService.AutoreviewPort => ({
  dispatch: (command) =>
    command.type === "message.dispatch" && command.dispatchMode.type === "steer_active"
      ? Effect.sync(() => {
          steered.push(command);
          return { sequence: 0, storedEvents: [] };
        })
      : orchestrator.dispatch(command),
  getThreadRecords: orchestrator.getThreadRecords,
  listActiveSubagentThreadIds: orchestrator.listActiveSubagentThreadIds,
});

const queuedFindings = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    return projection.runs
      .filter((run) => run.userMessageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX))
      .map((run) => ({
        status: run.status,
        text: projection.messages.find((message) => message.id === run.userMessageId)?.text ?? "",
      }));
  });

it.layer(layerTest)("autoreview", (it) => {
  it.effect(
    "attaching sends the backlog to a reviewer subagent whose task result is never handed back",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const service = AutoreviewService.make(orchestrator);
        const { threadId } = yield* seedReviewedThread("attach");

        const { reviewerThreadId, taskId } = yield* attachReviewer(
          service,
          threadId,
          "attach",
          "Focus on error handling.",
        );

        const reviewed = yield* orchestrator.getThreadProjection(threadId);
        const editOrdinal = reviewed.turnItems.find(
          (item) => item.id === TurnItemId.make("turn-item:attach:edit"),
        )?.ordinal;
        assert.isDefined(editOrdinal);
        assert.deepStrictEqual(
          reviewed.thread.autoreviewers?.map((reviewer) => ({
            threadId: reviewer.threadId,
            taskId: reviewer.taskId,
            brief: reviewer.brief,
            throughOrdinal: reviewer.throughOrdinal,
          })),
          [
            {
              threadId: reviewerThreadId,
              taskId,
              brief: "Focus on error handling.",
              throughOrdinal: editOrdinal!,
            },
          ],
        );
        const task = reviewed.subagents.find((candidate) => candidate.id === taskId);
        assert.equal(task?.completionDelivery?.state, "disposed");

        const reviewer = yield* orchestrator.getThreadProjection(reviewerThreadId);
        assert.equal(reviewer.thread.lineage.parentThreadId, threadId);
        assert.equal(reviewer.thread.lineage.relationshipToParent, "subagent");
        assert.isUndefined(reviewer.thread.autoreviewers);
        assert.equal(reviewer.thread.modelSelection.model, "gpt-6.1-sol");
        const backlog = reviewer.messages.find((message) => message.role === "user")?.text ?? "";
        assert.include(backlog, "You are an autoreviewer");
        assert.include(backlog, "Review brief: Focus on error handling.");
        assert.include(backlog, "Make parse() reject empty input.");
        assert.include(backlog, "throw new Error('empty')");
      }),
  );

  it.effect(
    "findings go to the live turn without being refused; an LGTM review stays with the reviewer",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const service = AutoreviewService.make(orchestrator);
        const { threadId, runId } = yield* seedReviewedThread("findings");
        const { reviewerThreadId } = yield* attachReviewer(service, threadId, "findings");

        const lgtm = yield* finishReview(reviewerThreadId, "LGTM", "findings-lgtm");
        yield* service.handle(lgtm.ended);
        assert.lengthOf(yield* messagesTo(threadId, AUTOREVIEW_FINDINGS_MESSAGE_PREFIX), 0);

        // A real finding from a later review is delivered into the reviewed thread's live run.
        const eventSink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        const more = assistantItem({
          threadId,
          runId,
          id: "findings:more",
          ordinal: 4,
          now,
          text: "Added a test.",
        });
        yield* eventSink.write({ events: [itemEvent(more)] });
        yield* service.handle(itemEvent(more));
        const batches = yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX);
        assert.lengthOf(batches, 1);

        const review = yield* finishReview(
          reviewerThreadId,
          "src/parse.ts:1 treats 0 as empty; check `value === ''`.",
          "findings-real",
        );
        yield* service.handle(review.ended);
        const findings = yield* messagesTo(threadId, AUTOREVIEW_FINDINGS_MESSAGE_PREFIX);
        assert.lengthOf(findings, 1);
        assert.include(findings[0]!.text, "treats 0 as empty");
        assert.equal(findings[0]!.senderThreadId, reviewerThreadId);
        const reviewed = yield* orchestrator.getThreadProjection(threadId);
        // The live run has no running provider turn to steer yet, so the findings wait right
        // behind it instead of being refused, and the run keeps going.
        assert.equal(
          reviewed.runs.find((run) => run.userMessageId === findings[0]!.id)?.status,
          "queued",
        );
        assert.equal(reviewed.runs.find((run) => run.id === runId)?.status, "running");
      }),
  );

  it.effect(
    "activity buffers while the reviewer is busy and goes out as one batch when it is done",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const service = AutoreviewService.make(orchestrator);
        const { threadId, runId, now } = yield* seedReviewedThread("buffer");
        const { reviewerThreadId } = yield* attachReviewer(service, threadId, "buffer");

        const command: OrchestrationV2TurnItem = {
          ...itemBase({ threadId, runId, id: "buffer:test", ordinal: 4, now }),
          type: "command_execution",
          input: "pnpm test parse",
          output: "1 failed",
          exitCode: 1,
        };
        const reply = assistantItem({
          threadId,
          runId,
          id: "buffer:fix",
          ordinal: 5,
          now,
          text: "Fixing the failure.",
        });
        for (const item of [command, reply]) {
          yield* eventSink.write({ events: [itemEvent(item)] });
          yield* service.handle(itemEvent(item));
        }
        // The reviewer is still on its first review, so nothing was sent yet.
        assert.lengthOf(yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX), 0);

        const done = yield* finishReview(reviewerThreadId, "LGTM", "buffer-first");
        yield* service.handle(done.ended);
        const batches = yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX);
        assert.lengthOf(batches, 1);
        assert.include(batches[0]!.text, "pnpm test parse");
        assert.include(batches[0]!.text, "Fixing the failure.");
        assert.notInclude(batches[0]!.text, "Make parse() reject empty input.");
        // A batch is not a follow-up task: its review is delivered by autoreview, not as a result.
        const batchRun = (yield* orchestrator.getThreadProjection(reviewerThreadId)).runs.find(
          (run) => run.userMessageId === batches[0]!.id,
        );
        assert.isDefined(batchRun);
        assert.isUndefined(batchRun?.delegatedTaskId);
        assert.lengthOf((yield* orchestrator.getThreadProjection(threadId)).subagents, 1);
        const reviewed = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          reviewed.thread.autoreviewers?.[0]?.throughOrdinal,
          reviewed.turnItems.find((item) => item.id === reply.id)?.ordinal,
        );

        // Nothing new: another event sends nothing.
        yield* service.handle(itemEvent(reply));
        assert.lengthOf(yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX), 1);
      }),
  );

  it.effect("several reviewers each get their own batches, and a removed one gets no more", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId, runId, now } = yield* seedReviewedThread("several");
      const first = yield* attachReviewer(service, threadId, "several-1");
      const second = yield* attachReviewer(service, threadId, "several-2", "Security only.");
      assert.lengthOf(yield* service.list(threadId), 2);
      // A reviewer made while another is attached does not inherit the reviewed thread's list.
      assert.isUndefined(
        (yield* orchestrator.getThreadProjection(second.reviewerThreadId)).thread.autoreviewers,
      );
      for (const [index, reviewer] of [first, second].entries()) {
        const done = yield* finishReview(reviewer.reviewerThreadId, "LGTM", `several-${index}`);
        yield* service.handle(done.ended);
      }

      const removed = yield* service.detach({
        commandId: CommandId.make("command:several:remove"),
        threadId,
        reviewerThreadId: first.reviewerThreadId,
      });
      assert.deepStrictEqual(removed, [first.reviewerThreadId]);

      const reply = assistantItem({
        threadId,
        runId,
        id: "several:next",
        ordinal: 4,
        now,
        text: "Next step.",
      });
      yield* eventSink.write({ events: [itemEvent(reply)] });
      yield* service.handle(itemEvent(reply));
      assert.lengthOf(
        yield* messagesTo(first.reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX),
        0,
      );
      assert.lengthOf(
        yield* messagesTo(second.reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX),
        1,
      );
      assert.deepStrictEqual(
        (yield* service.list(threadId)).map((reviewer) => reviewer.reviewerThreadId),
        [second.reviewerThreadId],
      );
    }),
  );

  it.effect("catch-up delivers a review whose completion event was missed, once", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId } = yield* seedReviewedThread("catchup");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "catchup");
      // The review finishes while nothing follows events (a restart).
      yield* finishReview(reviewerThreadId, "src/parse.ts:1 misses null.", "catchup-review");
      assert.lengthOf(yield* messagesTo(threadId, AUTOREVIEW_FINDINGS_MESSAGE_PREFIX), 0);

      yield* service.catchUp;
      yield* service.catchUp;
      const findings = yield* messagesTo(threadId, AUTOREVIEW_FINDINGS_MESSAGE_PREFIX);
      assert.lengthOf(findings, 1);
      assert.include(findings[0]!.text, "misses null");
    }),
  );

  it.effect("a missed review is delivered before new activity sends the next batch", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId, runId, now } = yield* seedReviewedThread("overtaken");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "overtaken");
      yield* finishReview(reviewerThreadId, "src/parse.ts:1 misses undefined.", "overtaken-review");

      // New activity arrives before catch-up looks at the reviewer.
      const next = assistantItem({
        threadId,
        runId,
        id: "overtaken:next",
        ordinal: 4,
        now,
        text: "Moving on.",
      });
      yield* eventSink.write({ events: [itemEvent(next)] });
      yield* service.handle(itemEvent(next));
      yield* service.catchUp;

      const findings = yield* messagesTo(threadId, AUTOREVIEW_FINDINGS_MESSAGE_PREFIX);
      assert.lengthOf(findings, 1);
      assert.include(findings[0]!.text, "misses undefined");
      assert.lengthOf(yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX), 1);
    }),
  );

  it.effect("findings after a Stop wait for the next turn instead of restarting the thread", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const steered: Array<DispatchCommand> = [];
      const service = AutoreviewService.make(steeringPort(orchestrator, steered));
      const { threadId, runId, now } = yield* seedReviewedThread("stopped");
      const first = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
        (run) => run.id === runId,
      )!;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("stopped:first-completed"),
            type: "run.updated",
            threadId,
            runId,
            occurredAt: now,
            payload: { ...first, status: "completed", completedAt: now },
          },
        ],
      });
      const send = (id: string) =>
        orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`stopped:${id}`),
          threadId,
          messageId: MessageId.make(`stopped:${id}`),
          text: "continue work",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
          dispatchMode: { type: "start_immediately" },
        });
      yield* send("before-stop");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "stopped");
      yield* orchestrator.dispatch({
        type: "thread.stop",
        commandId: CommandId.make("stopped:stop"),
        threadId,
        stopDelegatedTasks: true,
      });
      assert.equal(
        (yield* orchestrator.getThreadProjection(threadId)).runs.at(-1)?.status,
        "interrupted",
      );

      const review = yield* finishReview(
        reviewerThreadId,
        "src/parse.ts:1 misses null.",
        "stopped",
      );
      yield* service.handle(review.ended);
      const runs = (yield* orchestrator.getThreadProjection(threadId)).runs;
      assert.isFalse(
        runs.some((run) => run.userMessageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX)),
      );
      assert.lengthOf(steered, 0);

      // The user's next turn gets them.
      yield* send("after-stop");
      yield* service.handle(review.ended);
      assert.lengthOf(steered, 1);
      assert.include(steered[0]?.type === "message.dispatch" ? steered[0].text : "", "misses null");
    }),
  );

  it.effect("findings after a Stop on an idle thread wait too", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const steered: Array<DispatchCommand> = [];
      const service = AutoreviewService.make(steeringPort(orchestrator, steered));
      const { threadId, runId, now } = yield* seedReviewedThread("idle-stop");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "idle-stop");
      const first = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
        (run) => run.id === runId,
      )!;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("idle-stop:first-completed"),
            type: "run.updated",
            threadId,
            runId,
            occurredAt: now,
            payload: { ...first, status: "completed", completedAt: now },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "thread.stop",
        commandId: CommandId.make("idle-stop:stop"),
        threadId,
        stopDelegatedTasks: true,
      });

      const review = yield* finishReview(
        reviewerThreadId,
        "src/parse.ts:1 misses null.",
        "idle-stop",
      );
      yield* service.handle(review.ended);
      const runs = (yield* orchestrator.getThreadProjection(threadId)).runs;
      assert.deepStrictEqual(
        runs.map((run) => run.status),
        ["completed"],
      );
      assert.lengthOf(steered, 0);

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("idle-stop:resume"),
        threadId,
        messageId: MessageId.make("idle-stop:resume"),
        text: "continue work",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      yield* service.handle(review.ended);
      assert.lengthOf(steered, 1);
    }),
  );

  it.effect("findings steer into the reviewed thread's running turn", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const steered: Array<DispatchCommand> = [];
      const service = AutoreviewService.make(steeringPort(orchestrator, steered));
      const { threadId, runId } = yield* seedReviewedThread("steer");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "steer");

      const review = yield* finishReview(reviewerThreadId, "src/parse.ts:1 is wrong.", "steer");
      yield* service.handle(review.ended);

      assert.lengthOf(steered, 1);
      const command = steered[0]!;
      assert.equal(command.type, "message.dispatch");
      if (command.type !== "message.dispatch") return;
      assert.deepStrictEqual(command.dispatchMode, { type: "steer_active", targetRunId: runId });
      // Only the reviewer's name line, then its text.
      assert.equal(command.text, "Autoreview:\nsrc/parse.ts:1 is wrong.");
      assert.include(command.text, "src/parse.ts:1 is wrong.");
      assert.lengthOf(yield* queuedFindings(threadId), 0);
    }),
  );

  it.effect(
    "findings queued because a steer was refused are steered in once the turn can take them",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const promoted: Array<DispatchCommand> = [];
        // The orchestrator refuses the steer (no live session); promotion is recorded instead.
        const port: AutoreviewService.AutoreviewPort = {
          ...steeringPort(orchestrator, []),
          dispatch: (command) =>
            command.type === "queued-message.promote-to-steer"
              ? Effect.sync(() => {
                  promoted.push(command);
                  return { sequence: 0, storedEvents: [] };
                })
              : orchestrator.dispatch(command),
        };
        const service = AutoreviewService.make(port);
        const { threadId, runId, now } = yield* seedReviewedThread("promote");
        const { reviewerThreadId } = yield* attachReviewer(service, threadId, "promote");
        const review = yield* finishReview(reviewerThreadId, "promote: a real finding", "promote");
        yield* service.handle(review.ended);
        const queued = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
          (run) =>
            run.status === "queued" &&
            run.userMessageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX),
        );
        assert.isDefined(queued);

        const next = assistantItem({
          threadId,
          runId,
          id: "promote:next",
          ordinal: 30,
          now,
          text: "Working.",
        });
        yield* eventSink.write({ events: [itemEvent(next)] });
        yield* service.handle(itemEvent(next));
        const last = promoted.at(-1);
        assert.equal(last?.type, "queued-message.promote-to-steer");
        if (last?.type !== "queued-message.promote-to-steer") return;
        assert.equal(last.queuedRunId, queued!.id);
        assert.equal(last.targetRunId, runId);
      }),
  );

  it.effect("findings that cannot steer share one queued message, and removal drops its part", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId } = yield* seedReviewedThread("pile");
      const first = yield* attachReviewer(service, threadId, "pile-1");
      const second = yield* attachReviewer(service, threadId, "pile-2");

      // The test provider has no live session, so steering is refused and findings queue.
      for (const [index, reviewer] of [first, second].entries()) {
        const review = yield* finishReview(
          reviewer.reviewerThreadId,
          `finding number ${index + 1}`,
          `pile-${index}`,
        );
        yield* service.handle(review.ended);
      }
      const queued = yield* queuedFindings(threadId);
      assert.lengthOf(queued, 1);
      assert.include(queued[0]!.text, "finding number 1");
      assert.include(queued[0]!.text, "finding number 2");
      // Two reviewers, one message: one name line per finding and nothing else.
      assert.equal(
        queued[0]!.text,
        "Autoreview:\nfinding number 1\n\nAutoreview:\nfinding number 2",
      );

      yield* service.detach({
        commandId: CommandId.make("command:pile:remove-1"),
        threadId,
        reviewerThreadId: first.reviewerThreadId,
      });
      const afterFirst = yield* queuedFindings(threadId);
      assert.equal(afterFirst[0]!.status, "queued");
      assert.notInclude(afterFirst[0]!.text, "finding number 1");
      assert.include(afterFirst[0]!.text, "finding number 2");

      yield* service.detach({
        commandId: CommandId.make("command:pile:remove-2"),
        threadId,
        reviewerThreadId: second.reviewerThreadId,
      });
      assert.notEqual((yield* queuedFindings(threadId))[0]!.status, "queued");
    }),
  );

  it.effect("a reviewer's next batch shows the other reviewers' findings", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId, runId, now } = yield* seedReviewedThread("shared");
      const _first = yield* attachReviewer(service, threadId, "shared-1");
      const second = yield* attachReviewer(service, threadId, "shared-2");
      const done = yield* finishReview(second.reviewerThreadId, "LGTM", "shared-2");
      yield* service.handle(done.ended);

      // The first reviewer's findings reached the thread, then the agent kept working.
      const findings: OrchestrationV2TurnItem = {
        ...itemBase({ threadId, runId, id: "shared:findings", ordinal: 10, now }),
        type: "user_message",
        messageId: MessageId.make(`${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}shared`),
        createdBy: "agent",
        creationSource: "server",
        inputIntent: "turn_start",
        text: renderFindingsMessage([
          findingsSection({ reviewerTitle: "Reviewer C: x", review: "parse.ts:1 drops zero" }),
        ]),
        attachments: [],
      };
      const reply = assistantItem({
        threadId,
        runId,
        id: "shared:next",
        ordinal: 11,
        now,
        text: "Fixing zero.",
      });
      for (const item of [findings, reply]) {
        yield* eventSink.write({ events: [itemEvent(item)] });
        yield* service.handle(itemEvent(item));
      }
      const batches = yield* messagesTo(second.reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX);
      assert.lengthOf(batches, 1);
      assert.include(batches[0]!.text, "Reviewer C:\nparse.ts:1 drops zero");
      assert.include(batches[0]!.text, "parse.ts:1 drops zero");
      assert.include(batches[0]!.text, "Fixing zero.");
    }),
  );

  it.effect("a reviewer never sees any of its own steered findings as another's", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const steered: Array<DispatchCommand> = [];
      const service = AutoreviewService.make(steeringPort(orchestrator, steered));
      const { threadId, runId, now } = yield* seedReviewedThread("mine");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "mine");
      const write = (item: OrchestrationV2TurnItem) =>
        eventSink
          .write({ events: [itemEvent(item)] })
          .pipe(Effect.andThen(service.handle(itemEvent(item))));
      const step = (id: string, ordinal: number) =>
        write(assistantItem({ threadId, runId, id, ordinal, now, text: `Step ${id}.` }));

      const first = yield* finishReview(reviewerThreadId, "mine: first finding", "mine-1");
      yield* service.handle(first.ended);
      yield* step("mine:a", 20);
      const second = yield* finishReview(reviewerThreadId, "mine: second finding", "mine-2");
      yield* service.handle(second.ended);
      assert.lengthOf(steered, 2);

      // Both steers land in the thread, then the agent goes on.
      for (const [index, command] of steered.entries()) {
        if (command.type !== "message.dispatch") continue;
        yield* write({
          ...itemBase({ threadId, runId, id: `mine:findings-${index}`, ordinal: 21 + index, now }),
          type: "user_message",
          messageId: command.messageId,
          createdBy: "agent",
          creationSource: "server",
          inputIntent: "steer",
          text: command.text,
          attachments: [],
        });
      }
      yield* step("mine:b", 30);
      const batches = yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX);
      const last = batches.at(-1)!;
      assert.include(last.text, "Step mine:b.");
      assert.notInclude(last.text, "first finding");
      assert.notInclude(last.text, "second finding");
      assert.notInclude(last.text, "already raised");
    }),
  );

  it.effect("removal drops every one of a reviewer's queued findings, however many", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId, runId, now } = yield* seedReviewedThread("many");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "many");
      for (let index = 0; index < 21; index++) {
        const review = yield* finishReview(
          reviewerThreadId,
          `many finding ${index}`,
          `many-${index}`,
        );
        yield* service.handle(review.ended);
        const item = assistantItem({
          threadId,
          runId,
          id: `many:step-${index}`,
          ordinal: 20 + index,
          now,
          text: `Step ${index}.`,
        });
        yield* eventSink.write({ events: [itemEvent(item)] });
        yield* service.handle(itemEvent(item));
      }
      const queued = yield* queuedFindings(threadId);
      assert.lengthOf(queued, 1);
      assert.include(queued[0]!.text, "many finding 0");
      assert.include(queued[0]!.text, "many finding 20");

      yield* service.detach({
        commandId: CommandId.make("command:many:remove"),
        threadId,
        reviewerThreadId,
      });
      assert.notEqual((yield* queuedFindings(threadId))[0]!.status, "queued");
    }),
  );

  it.effect("a review appended to another's queued findings is not appended again", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId } = yield* seedReviewedThread("append-guard");
      const first = yield* attachReviewer(service, threadId, "append-guard-1");
      const second = yield* attachReviewer(service, threadId, "append-guard-2");
      const a = yield* finishReview(first.reviewerThreadId, "guard finding A", "append-guard-1");
      yield* service.handle(a.ended);
      const b = yield* finishReview(second.reviewerThreadId, "guard finding B", "append-guard-2");
      yield* service.handle(b.ended);

      // The joint message is consumed: its turn runs and ends.
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const joint = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
        (run) =>
          run.status === "queued" &&
          run.userMessageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX),
      )!;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:append-guard:consumed"),
            type: "run.updated",
            threadId,
            runId: joint.id,
            providerInstanceId: joint.providerInstanceId,
            occurredAt: now,
            payload: { ...joint, status: "completed", startedAt: now, completedAt: now },
          },
        ],
      });

      // A rollback rewrites the second reviewer without lastReviewedRunId.
      const records = (yield* orchestrator.getThreadProjection(threadId)).thread.autoreviewers!;
      yield* orchestrator.dispatch({
        type: "thread.autoreviewers.set",
        commandId: CommandId.make("command:append-guard:rollback"),
        threadId,
        autoreviewers: records.map((record) => {
          if (record.threadId !== second.reviewerThreadId) return record;
          const { lastReviewedRunId: _dropped, ...rolledBack } = record;
          return rolledBack;
        }),
      });
      yield* service.handle(b.ended);
      const all = yield* queuedFindings(threadId);
      assert.lengthOf(all, 1);
      assert.equal(all[0]!.text.split("guard finding B").length - 1, 1);
    }),
  );

  it.effect("update changes a reviewer's model and brief and keeps its place", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId, runId, now } = yield* seedReviewedThread("update");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "update", "Everything");
      const done = yield* finishReview(reviewerThreadId, "LGTM", "update");
      yield* service.handle(done.ended);
      const before = (yield* orchestrator.getThreadProjection(threadId)).thread.autoreviewers![0]!;

      yield* service.update({
        commandId: CommandId.make("command:update"),
        threadId,
        reviewerThreadId,
        modelSelection: { ...reviewerModel, model: "gpt-6.1-terra" },
        brief: "Only security",
      });
      const reviewer = yield* orchestrator.getThreadProjection(reviewerThreadId);
      assert.equal(reviewer.thread.modelSelection.model, "gpt-6.1-terra");
      const after = (yield* orchestrator.getThreadProjection(threadId)).thread.autoreviewers![0]!;
      assert.equal(after.brief, "Only security");
      assert.equal(after.throughOrdinal, before.throughOrdinal);
      assert.equal(after.threadId, reviewerThreadId);

      const reply = assistantItem({
        threadId,
        runId,
        id: "update:next",
        ordinal: 12,
        now,
        text: "Next step.",
      });
      yield* eventSink.write({ events: [itemEvent(reply)] });
      yield* service.handle(itemEvent(reply));
      const batches = yield* messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX);
      assert.lengthOf(batches, 1);
      assert.include(batches[0]!.text, "Review brief: Only security");
      assert.include(batches[0]!.text, "Next step.");
      assert.notInclude(batches[0]!.text, "Make parse() reject empty input.");
      const sent = (yield* orchestrator.getThreadProjection(threadId)).thread.autoreviewers![0]!;
      assert.isUndefined(sent.resendInstructions);
    }),
  );

  it.effect(
    "a reviewer with a minimum batch size waits for a large buffer or the end of the turn",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const service = AutoreviewService.make(orchestrator);
        const { threadId, runId, now } = yield* seedReviewedThread("slow");
        const { reviewerThreadId } = yield* attachReviewer(
          service,
          threadId,
          "slow",
          undefined,
          6_000,
        );
        const done = yield* finishReview(reviewerThreadId, "LGTM", "slow");
        yield* service.handle(done.ended);
        const batches = () => messagesTo(reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX);

        const small = assistantItem({
          threadId,
          runId,
          id: "slow:small",
          ordinal: 20,
          now,
          text: "Small step.",
        });
        yield* eventSink.write({ events: [itemEvent(small)] });
        yield* service.handle(itemEvent(small));
        assert.lengthOf(yield* batches(), 0);

        const large = assistantItem({
          threadId,
          runId,
          id: "slow:large",
          ordinal: 21,
          now,
          text: "x".repeat(6_000),
        });
        yield* eventSink.write({ events: [itemEvent(large)] });
        yield* service.handle(itemEvent(large));
        assert.lengthOf(yield* batches(), 1);
        assert.include((yield* batches())[0]!.text, "Small step.");

        // A small remainder still goes out once the reviewed turn ends.
        const second = yield* finishReview(reviewerThreadId, "LGTM", "slow-2");
        yield* service.handle(second.ended);
        const tail = assistantItem({
          threadId,
          runId,
          id: "slow:tail",
          ordinal: 22,
          now,
          text: "Last words.",
        });
        yield* eventSink.write({ events: [itemEvent(tail)] });
        yield* service.handle(itemEvent(tail));
        assert.lengthOf(yield* batches(), 1);
        const run = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
          (r) => r.id === runId,
        )!;
        const ended: OrchestrationV2DomainEvent = {
          id: EventId.make("event:slow:ended"),
          type: "run.updated",
          threadId,
          runId,
          providerInstanceId: modelSelection.instanceId,
          occurredAt: now,
          payload: { ...run, status: "completed", completedAt: now },
        };
        yield* eventSink.write({ events: [ended] });
        yield* service.handle(ended);
        assert.lengthOf(yield* batches(), 2);
        assert.include((yield* batches())[1]!.text, "Last words.");
      }),
  );

  it.effect(
    "a reviewer's second findings join the queued message without replacing its first",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const service = AutoreviewService.make(orchestrator);
        const { threadId, runId, now } = yield* seedReviewedThread("twice");
        const { reviewerThreadId } = yield* attachReviewer(service, threadId, "twice");
        const first = yield* finishReview(reviewerThreadId, "first finding", "twice-1");
        yield* service.handle(first.ended);
        const more = assistantItem({
          threadId,
          runId,
          id: "twice:more",
          ordinal: 40,
          now,
          text: "More work.",
        });
        yield* eventSink.write({ events: [itemEvent(more)] });
        yield* service.handle(itemEvent(more));
        const second = yield* finishReview(reviewerThreadId, "second finding", "twice-2");
        yield* service.handle(second.ended);
        const queued = (yield* queuedFindings(threadId)).filter((run) => run.status === "queued");
        assert.lengthOf(queued, 1);
        assert.include(queued[0]!.text, "first finding");
        assert.include(queued[0]!.text, "second finding");

        // Removal drops both of its sections.
        yield* service.detach({
          commandId: CommandId.make("command:twice:remove"),
          threadId,
          reviewerThreadId,
        });
        assert.lengthOf(
          (yield* queuedFindings(threadId)).filter((run) => run.status === "queued"),
          0,
        );
      }),
  );

  it.effect("a run typed to the reviewer does not hide the review that finished before it", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId } = yield* seedReviewedThread("typed");
      const { reviewerThreadId } = yield* attachReviewer(service, threadId, "typed");
      // The review finishes, but its event is missed; then someone messages the reviewer.
      yield* finishReview(reviewerThreadId, "the real finding", "typed-review");
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("command:typed:question"),
        threadId: reviewerThreadId,
        messageId: MessageId.make("message:typed:question"),
        text: "Why?",
        attachments: [],
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "queue_after_active" },
      });
      const answered = yield* finishReview(reviewerThreadId, "Because.", "typed-answer");
      yield* service.handle(answered.ended);
      const queued = yield* queuedFindings(threadId);
      assert.lengthOf(queued, 1);
      assert.include(queued[0]!.text, "the real finding");
      assert.notInclude(queued[0]!.text, "Because.");
    }),
  );

  it.effect(
    "a review already in the thread is not delivered again when the record lost its place",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const steered: Array<DispatchCommand> = [];
        // Steers are recorded and still land in the thread, as a real steer does.
        const port: AutoreviewService.AutoreviewPort = {
          ...steeringPort(orchestrator, []),
          dispatch: (command) =>
            command.type === "message.dispatch" && command.dispatchMode.type === "steer_active"
              ? Effect.sync(() => steered.push(command)).pipe(
                  Effect.andThen(
                    orchestrator.dispatch({
                      ...command,
                      dispatchMode: { type: "queue_after_active" },
                    }),
                  ),
                )
              : orchestrator.dispatch(command),
        };
        const service = AutoreviewService.make(port);
        const { threadId } = yield* seedReviewedThread("guard");
        const { reviewerThreadId } = yield* attachReviewer(service, threadId, "guard");
        const review = yield* finishReview(reviewerThreadId, "only once", "guard");
        yield* service.handle(review.ended);
        assert.lengthOf(steered, 1);

        // A rollback rewrites the reviewer without lastReviewedRunId.
        const record = (yield* orchestrator.getThreadProjection(threadId)).thread
          .autoreviewers![0]!;
        const { lastReviewedRunId: _dropped, ...rolledBack } = record;
        yield* orchestrator.dispatch({
          type: "thread.autoreviewers.set",
          commandId: CommandId.make("command:guard:rollback"),
          threadId,
          autoreviewers: [rolledBack],
        });
        yield* service.handle(review.ended);
        assert.lengthOf(steered, 1);
      }),
  );

  it.effect(
    "an answerer gets a user's message at once; other reviewers wait for agent activity",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const eventSink = yield* EventSink.EventSinkV2;
        const service = AutoreviewService.make(orchestrator);
        const { threadId, runId, now } = yield* seedReviewedThread("answer");
        const answerer = yield* attachReviewer(
          service,
          threadId,
          "answer-1",
          undefined,
          undefined,
          true,
        );
        const reviewer = yield* attachReviewer(service, threadId, "answer-2");
        for (const [index, attached] of [answerer, reviewer].entries()) {
          const done = yield* finishReview(attached.reviewerThreadId, "LGTM", `answer-${index}`);
          yield* service.handle(done.ended);
        }
        const question: OrchestrationV2TurnItem = {
          ...itemBase({ threadId, runId, id: "answer:question", ordinal: 50, now }),
          type: "user_message",
          messageId: MessageId.make("message:answer:question"),
          createdBy: "user",
          creationSource: "mobile",
          inputIntent: "turn_start",
          text: "Is the mock at 22:15?",
          attachments: [],
        };
        yield* eventSink.write({ events: [itemEvent(question)] });
        yield* service.handle(itemEvent(question));
        const toAnswerer = yield* messagesTo(
          answerer.reviewerThreadId,
          AUTOREVIEW_BATCH_MESSAGE_PREFIX,
        );
        assert.lengthOf(toAnswerer, 1);
        assert.include(toAnswerer[0]!.text, "Is the mock at 22:15?");
        assert.lengthOf(
          yield* messagesTo(reviewer.reviewerThreadId, AUTOREVIEW_BATCH_MESSAGE_PREFIX),
          0,
        );
      }),
  );

  it.effect("list reports each reviewer's title, model and settings", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId } = yield* seedReviewedThread("listed");
      const { reviewerThreadId } = yield* attachReviewer(
        service,
        threadId,
        "listed",
        "a brief",
        5_000,
        true,
      );
      const [status] = yield* service.list(threadId);
      assert.equal(status?.reviewerThreadId, reviewerThreadId);
      assert.isString(status?.title);
      assert.equal(status?.model, "gpt-6.1-sol reasoningEffort=xhigh");
      assert.equal(status?.minBatchChars, 5_000);
      assert.isTrue(status?.wakeOnUserMessage);
      assert.equal(status?.brief, "a brief");
    }),
  );

  it.effect("refuses to attach to a thread that is not working", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const service = AutoreviewService.make(orchestrator);
      const { threadId, runId, now } = yield* seedReviewedThread("idle");
      const run = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
        (r) => r.id === runId,
      )!;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:idle:ended"),
            type: "run.updated",
            threadId,
            runId,
            providerInstanceId: modelSelection.instanceId,
            occurredAt: now,
            payload: { ...run, status: "completed", completedAt: now },
          },
        ],
      });
      const error = yield* Effect.flip(attachReviewer(service, threadId, "idle"));
      assert.equal(error.reason, "not_active");
    }),
  );
});
