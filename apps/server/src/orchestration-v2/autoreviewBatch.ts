import type {
  OrchestrationV2AppThread,
  OrchestrationV2Autoreviewer,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  TurnItemId,
} from "@t3tools/contracts";

/** Message ids the reviewer flushes use; the reactor recognizes reviewer runs by them. */
export const AUTOREVIEW_BATCH_MESSAGE_PREFIX = "message:autoreview-batch:";
/** Message ids of findings delivered to the reviewed thread. */
export const AUTOREVIEW_FINDINGS_MESSAGE_PREFIX = "message:autoreview-findings:";

/** Turns in a row that findings may start on an idle reviewed thread without a user message. */
export const MAX_CONSECUTIVE_AUTOREVIEW_WAKES = 3;

const BATCH_MAX_CHARS = 48_000;
const ITEM_MAX_CHARS = 12_000;

export const AUTOREVIEW_REVIEWABLE_TYPES = [
  "user_message",
  "assistant_message",
  "command_execution",
  "file_change",
  "proposed_plan",
  "error",
  "run_interrupt_result",
] as const satisfies ReadonlyArray<OrchestrationV2TurnItem["type"]>;

const TERMINAL_ITEM_STATUSES: ReadonlySet<OrchestrationV2TurnItem["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const isAutoreviewFindingsMessageId = (messageId: string): boolean =>
  messageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX);

/** Items a reviewer sees. Findings sent back to the reviewed thread are not echoed to reviewers. */
export function isReviewableItem(item: OrchestrationV2TurnItem): boolean {
  switch (item.type) {
    case "user_message":
      return !isAutoreviewFindingsMessageId(item.messageId);
    case "assistant_message":
    case "proposed_plan":
      return !item.streaming;
    case "command_execution":
      return item.monitor !== true;
    case "file_change":
    case "error":
    case "run_interrupt_result":
      return true;
    default:
      return false;
  }
}

export const isTerminalItem = (item: Pick<OrchestrationV2TurnItem, "status">): boolean =>
  TERMINAL_ITEM_STATUSES.has(item.status);

export interface AutoreviewBatchPlan {
  /** Finished items not yet sent, oldest first. */
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly throughOrdinal: number;
  readonly sentItemIds: ReadonlyArray<TurnItemId>;
}

/**
 * The reviewer's buffer: every finished reviewable item after its cursor that it has not seen.
 * The cursor moves only past a contiguous run of finished items, so an item that is still
 * running (a long command) is sent once it finishes; later items that finished first are
 * remembered in `sentItemIds` so they are never sent twice.
 */
export function planAutoreviewBatch(input: {
  readonly reviewer: Pick<OrchestrationV2Autoreviewer, "throughOrdinal" | "sentItemIds">;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
}): AutoreviewBatchPlan {
  const sent = new Set<string>(input.reviewer.sentItemIds);
  const candidates = input.items
    .filter((item) => item.ordinal > input.reviewer.throughOrdinal && isReviewableItem(item))
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const items = candidates.filter((item) => isTerminalItem(item) && !sent.has(item.id));
  let throughOrdinal = input.reviewer.throughOrdinal;
  for (const item of candidates) {
    if (!isTerminalItem(item)) break;
    throughOrdinal = item.ordinal;
  }
  const sentItemIds = [
    ...input.reviewer.sentItemIds.filter((id) =>
      candidates.some((item) => item.id === id && item.ordinal > throughOrdinal),
    ),
    ...items.filter((item) => item.ordinal > throughOrdinal).map((item) => item.id),
  ];
  return { items, throughOrdinal, sentItemIds };
}

/**
 * A lone user message waits for the agent's first activity, so a reviewer is not woken to
 * review a request nobody has acted on yet.
 */
export const batchHasAgentActivity = (plan: AutoreviewBatchPlan): boolean =>
  plan.items.some((item) => item.type !== "user_message");

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n[... ${text.length - max} characters omitted ...]\n${text.slice(text.length - tail)}`;
}

function renderReviewItem(item: OrchestrationV2TurnItem): string | null {
  const status = item.status === "completed" ? "" : ` (${item.status})`;
  switch (item.type) {
    case "user_message":
      return `### User message${status}\n${clip(item.text, ITEM_MAX_CHARS)}`;
    case "assistant_message":
      return `### Assistant${status}\n${clip(item.text, ITEM_MAX_CHARS)}`;
    case "command_execution":
      return [
        `### Command${status}, exit code ${item.exitCode ?? "unknown"}`,
        "```",
        `$ ${clip(item.input, 2_000)}`,
        clip(item.output ?? "", ITEM_MAX_CHARS),
        "```",
      ].join("\n");
    case "file_change": {
      const paths = item.changes?.map((change) => change.path).join(", ") ?? item.fileName;
      const counts =
        item.additions === undefined && item.deletions === undefined
          ? ""
          : ` (+${item.additions ?? 0} -${item.deletions ?? 0})`;
      const diff =
        item.diffStr ??
        (item.oldStr !== undefined || item.newStr !== undefined
          ? `--- before\n${item.oldStr ?? ""}\n+++ after\n${item.newStr ?? ""}`
          : undefined);
      return [
        `### File change${status}: ${paths}${counts}`,
        ...(diff ? ["```diff", clip(diff, ITEM_MAX_CHARS), "```"] : []),
      ].join("\n");
    }
    case "proposed_plan":
      return `### Proposed plan\n${clip(item.markdown, ITEM_MAX_CHARS)}`;
    case "error":
      return `### Error\n${clip(item.failure.message, ITEM_MAX_CHARS)}`;
    case "run_interrupt_result":
      return `### Turn interrupted\n${clip(item.message, ITEM_MAX_CHARS)}`;
    default:
      return null;
  }
}

function autoreviewInstructions(input: {
  readonly reviewedThread: Pick<OrchestrationV2AppThread, "id" | "title">;
  readonly brief?: string | undefined;
}): string {
  return [
    `You are an autoreviewer for the T3 thread "${input.reviewedThread.title}" (${input.reviewedThread.id}). Its activity reaches you automatically in batches while it works: user requests, its messages, commands with output, and file diffs. Each later message holds only what happened since the previous batch.`,
    "Review each batch for real problems: bugs, wrong or risky actions, claims the evidence does not support, missed requirements, and departures from what the user asked. Read files in the shared checkout when you need more context, but do not edit files, run commands that change state, or message other threads.",
    "Your reply is delivered to the reviewed agent, so make it short, specific, and actionable, with file:line references where you can. If nothing in the batch needs the agent's attention, reply with exactly LGTM and nothing is delivered.",
    ...(input.brief?.trim() ? [`Review brief: ${input.brief.trim()}`] : []),
  ].join("\n\n");
}

/** The message a reviewer receives; oversized batches keep the newest items. */
export function renderAutoreviewBatch(input: {
  readonly reviewedThread: Pick<OrchestrationV2AppThread, "id" | "title">;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly first: boolean;
  readonly brief?: string | undefined;
}): string {
  const preamble = input.first ? `${autoreviewInstructions(input)}\n\n` : "";
  const header = input.first
    ? `Activity so far in thread ${input.reviewedThread.id}:`
    : `New activity in thread ${input.reviewedThread.id} since your last batch:`;
  const rendered = input.items.flatMap((item) => {
    const text = renderReviewItem(item);
    return text === null ? [] : [text];
  });
  // On the first batch the opening request is kept even when earlier items are dropped.
  const pinned = input.first && input.items[0]?.type === "user_message" ? rendered[0] : undefined;
  const rest = pinned === undefined ? rendered : rendered.slice(1);
  const omittedNote = (count: number) =>
    `[${count} earlier item${count === 1 ? "" : "s"} omitted; read them with t3_thread_read on thread ${input.reviewedThread.id}.]`;
  let remaining =
    BATCH_MAX_CHARS -
    preamble.length -
    header.length -
    (pinned?.length ?? 0) -
    omittedNote(rest.length).length -
    8;
  const kept: Array<string> = [];
  for (let index = rest.length - 1; index >= 0; index--) {
    const text = rest[index]!;
    if (text.length + 2 > remaining) break;
    kept.unshift(text);
    remaining -= text.length + 2;
  }
  const omitted = rest.length - kept.length;
  return [
    `${preamble}${header}`,
    ...(pinned === undefined ? [] : [pinned]),
    ...(omitted > 0 ? [omittedNote(omitted)] : []),
    ...kept,
  ].join("\n\n");
}

/** A review that asks nothing of the agent: its first non-empty line starts with LGTM. */
export function isLgtmReview(text: string): boolean {
  const firstLine = text
    .split("\n")
    .map((line) => line.replace(/[*_`#>\s]/g, ""))
    .find((line) => line.length > 0);
  return firstLine !== undefined && /^lgtm(?![a-z])/i.test(firstLine);
}

/** Idle-thread turns started by findings since the last turn anything else started. */
function consecutiveAutoreviewWakes(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "ordinal" | "userMessageId" | "status">>,
): number {
  let count = 0;
  for (const run of runs.toSorted((left, right) => right.ordinal - left.ordinal)) {
    if (run.status === "rolled_back") continue;
    if (!isAutoreviewFindingsMessageId(run.userMessageId)) break;
    count++;
  }
  return count;
}

export type FindingsDelivery =
  /** Into the live turn when its provider can take it, otherwise right after it. */
  | { readonly type: "steer"; readonly targetRunId: OrchestrationV2Run["id"] }
  | { readonly type: "queue" }
  | { readonly type: "start" }
  | { readonly type: "skip"; readonly reason: string };

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

/**
 * Findings steer the reviewed thread's live turn. They queue behind work that is already
 * queued (a held queue keeps them held), and start a turn on an idle thread unless findings
 * already started too many turns in a row.
 */
export function planFindingsDelivery(runs: ReadonlyArray<OrchestrationV2Run>): FindingsDelivery {
  const active = runs
    .filter((run) => ACTIVE_RUN_STATUSES.has(run.status))
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
  if (active !== undefined) return { type: "steer", targetRunId: active.id };
  if (runs.some((run) => run.status === "queued")) return { type: "queue" };
  if (consecutiveAutoreviewWakes(runs) >= MAX_CONSECUTIVE_AUTOREVIEW_WAKES) {
    return {
      type: "skip",
      reason: `findings already started ${MAX_CONSECUTIVE_AUTOREVIEW_WAKES} turns in a row`,
    };
  }
  return { type: "start" };
}
