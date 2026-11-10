import type {
  OrchestrationV2AppThread,
  OrchestrationV2Autoreviewer,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  TurnItemId,
} from "@t3tools/contracts";
import { latestExecutedRun } from "@t3tools/shared/orchestrationV2ThreadError";
import { DateTime } from "effect";

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
  "dynamic_tool",
  "web_search",
  "file_search",
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

export const isAutoreviewFindingsMessageId = (messageId: string): boolean =>
  messageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX);

/** The wrapper findings messages had before; old messages in threads still carry it. */
const LEGACY_FINDINGS_HEADER =
  "Autoreview findings from reviewers that review your work as you go. Weigh each point: act on the ones that hold up and say briefly why you skip any. Do not reply to the reviewers; they see your next activity.";

/** A reviewer's short name: its title up to the first colon ("Reviewer A: ..." -> "Reviewer A"). */
function reviewerName(title: string): string {
  const colon = title.indexOf(":");
  const name = (colon > 0 ? title.slice(0, colon) : title).trim();
  return name.length > 0 ? name : "Autoreview";
}

/**
 * One reviewer's findings as the reviewed thread shows them: a line with its name, then the
 * text. Nothing else is added. Blank lines inside the
 * review are dropped, so a blank line in a findings message always separates two sections.
 */
export const findingsSection = (input: {
  readonly reviewerTitle: string;
  readonly review: string;
}): string =>
  `${reviewerName(input.reviewerTitle)}:\n${input.review.trim().replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n")}`;

/** Several reviewers' findings in one message, one name line each. */
export const renderFindingsMessage = (sections: ReadonlyArray<string>): string =>
  sections.join("\n\n");

/** The findings in a findings message, without the old wrapper. */
export const findingsBody = (text: string): string =>
  text.replace(LEGACY_FINDINGS_HEADER, "").trim();

/**
 * Where `section` stands whole in `text`: at the start or after a blank line, and at the end or
 * before one. A longer finding that merely starts with the same words is not a match.
 */
function sectionIndex(text: string, section: string): number {
  if (section.length === 0) return -1;
  for (let index = text.indexOf(section); index !== -1; index = text.indexOf(section, index + 1)) {
    const end = index + section.length;
    const starts = index === 0 || text.slice(index - 2, index) === "\n\n";
    const ends = end === text.length || text.slice(end, end + 2) === "\n\n";
    if (starts && ends) return index;
  }
  return -1;
}

/** Whether a findings message holds this section whole. */
export const hasSection = (text: string, section: string): boolean =>
  sectionIndex(text, section) !== -1;

/** `text` with one whole copy of a reviewer's section taken out. */
export function findingsWithout(text: string, section: string | undefined): string {
  const index = section === undefined ? -1 : sectionIndex(text, section);
  if (index === -1) return text;
  return `${text.slice(0, index)}${text.slice(index + section!.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A reviewer's sections still to be recognized as its own; older records kept two fields. */
export const ownSections = (
  reviewer: Pick<OrchestrationV2Autoreviewer, "ownSections" | "queuedSections" | "lastSection">,
): ReadonlyArray<string> =>
  reviewer.ownSections ?? [
    ...(reviewer.queuedSections ?? []),
    ...(reviewer.lastSection === undefined ? [] : [reviewer.lastSection]),
  ];

/**
 * Items a reviewer sees once they finish. Findings sent back to the reviewed thread are
 * included so reviewers see what the others already raised; like user messages, they never
 * wake a reviewer on their own.
 */
export function isReviewableItem(item: OrchestrationV2TurnItem): boolean {
  switch (item.type) {
    case "user_message":
      return true;
    case "command_execution":
      return item.monitor !== true;
    case "assistant_message":
    case "proposed_plan":
    case "file_change":
    case "dynamic_tool":
    case "web_search":
    case "file_search":
    case "error":
    case "run_interrupt_result":
      return true;
    default:
      return false;
  }
}

/** Finished: a terminal status, and streamed text that is complete. */
export const isTerminalItem = (item: OrchestrationV2TurnItem): boolean =>
  TERMINAL_ITEM_STATUSES.has(item.status) &&
  !((item.type === "assistant_message" || item.type === "proposed_plan") && item.streaming);

export interface AutoreviewBatchPlan {
  /** Finished items not yet sent, oldest first. */
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  /** Tool calls still running after the cursor, shown so a reviewer sees what is under way. */
  readonly running?: ReadonlyArray<OrchestrationV2TurnItem>;
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
  /** The reviewed thread's runs; findings waiting in the queue can still grow. */
  readonly runs?: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">>;
}): AutoreviewBatchPlan {
  const sent = new Set<string>(input.reviewer.sentItemIds);
  const queued = new Set<string>(
    (input.runs ?? []).filter((run) => run.status === "queued").map((run) => run.id),
  );
  // A queued findings message is edited in place as findings join it, so it is sent once its
  // turn starts and its text is final.
  const finished = (item: OrchestrationV2TurnItem) =>
    isTerminalItem(item) &&
    !(
      item.type === "user_message" &&
      isAutoreviewFindingsMessageId(item.messageId) &&
      item.runId !== null &&
      queued.has(item.runId)
    );
  const candidates = input.items
    .filter((item) => item.ordinal > input.reviewer.throughOrdinal && isReviewableItem(item))
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const items = candidates.filter((item) => finished(item) && !sent.has(item.id));
  let throughOrdinal = input.reviewer.throughOrdinal;
  for (const item of candidates) {
    if (!finished(item)) break;
    throughOrdinal = item.ordinal;
  }
  const sentItemIds = [
    ...input.reviewer.sentItemIds.filter((id) =>
      candidates.some((item) => item.id === id && item.ordinal > throughOrdinal),
    ),
    ...items.filter((item) => item.ordinal > throughOrdinal).map((item) => item.id),
  ];
  const running = candidates.filter((item) => isToolCall(item) && !isTerminalItem(item));
  return { items, throughOrdinal, sentItemIds, running };
}

/** A command, file change, tool or search call: what `wakeOnToolCall` reacts to. */
const isToolCall = (item: OrchestrationV2TurnItem): boolean =>
  item.type === "command_execution" ||
  item.type === "file_change" ||
  item.type === "dynamic_tool" ||
  item.type === "web_search" ||
  item.type === "file_search";

export const batchHasToolCall = (plan: AutoreviewBatchPlan): boolean => plan.items.some(isToolCall);

/**
 * A lone user message waits for the agent's first activity, so a reviewer is not woken to
 * review a request nobody has acted on yet.
 */
export const batchHasAgentActivity = (plan: AutoreviewBatchPlan): boolean =>
  plan.items.some((item) => item.type !== "user_message");

/**
 * A message from the user or sent through a tool (the Discord relay, another agent), not
 * findings or server notices. A reviewer with wakeOnUserMessage answers these at once.
 */
export const batchHasUserMessage = (plan: AutoreviewBatchPlan): boolean =>
  plan.items.some(
    (item) =>
      item.type === "user_message" &&
      !isAutoreviewFindingsMessageId(item.messageId) &&
      (item.createdBy === "user" || item.creationSource === "mcp"),
  );

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n[... ${text.length - max} characters omitted ...]\n${text.slice(text.length - tail)}`;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One line per tool call still running, e.g. a long command the agent waits on. */
function runningLine(item: OrchestrationV2TurnItem): string {
  const started = item.startedAt === null ? "" : ` since ${DateTime.formatIso(item.startedAt)}`;
  switch (item.type) {
    case "command_execution":
      return `- command${started}: ${clip(item.input, 300)}`;
    case "dynamic_tool":
      return `- tool ${item.toolName ?? "call"}${started}: ${clip(toText(item.input), 300)}`;
    default:
      return `- ${item.type}${started}`;
  }
}

function renderReviewItem(
  item: OrchestrationV2TurnItem,
  ownFindings: ReadonlyArray<string>,
): string | null {
  const status = item.status === "completed" ? "" : ` (${item.status})`;
  switch (item.type) {
    case "user_message": {
      if (!isAutoreviewFindingsMessageId(item.messageId)) {
        return `### User message${status}\n${clip(item.text, ITEM_MAX_CHARS)}`;
      }
      // A reviewer's own findings are left out; it wrote them.
      const others = findingsBody(
        ownFindings.reduce((text, own) => findingsWithout(text, own), item.text),
      );
      return others.length === 0
        ? null
        : `### Findings other reviewers already raised (do not raise them again)\n${clip(others, ITEM_MAX_CHARS)}`;
    }
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
    case "dynamic_tool":
      return [
        `### Tool ${item.toolName ?? "call"}${status}`,
        "```",
        `input: ${clip(toText(item.input), 2_000)}`,
        ...(item.output === undefined ? [] : [`output: ${clip(toText(item.output), 6_000)}`]),
        "```",
      ].join("\n");
    case "web_search":
      return `### Web search${status}: ${clip((item.patterns ?? []).join(" | "), 1_000)}`;
    case "file_search":
      return `### File search${status}: ${clip(item.pattern ?? "", 1_000)}`;
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

const LGTM_RULE =
  "Your reply is delivered to the reviewed agent. If nothing in the batch needs the agent's attention, reply with exactly LGTM and nothing is delivered.";

function autoreviewInstructions(input: {
  readonly reviewedThread: Pick<OrchestrationV2AppThread, "id" | "title">;
  readonly brief?: string | undefined;
  readonly preamble?: string | undefined;
}): string {
  const brief = input.brief?.trim() ? [`Review brief: ${input.brief.trim()}`] : [];
  // A custom preamble replaces the standard role text; the delivery rule always applies.
  if (input.preamble?.trim()) {
    return [
      `Activity of the T3 thread "${input.reviewedThread.title}" (${input.reviewedThread.id}) reaches you automatically in batches; each later message holds only what happened since the previous one.`,
      input.preamble.trim(),
      LGTM_RULE,
      ...brief,
    ].join("\n\n");
  }
  return [
    `You are an autoreviewer for the T3 thread "${input.reviewedThread.title}" (${input.reviewedThread.id}). Its activity reaches you automatically in batches while it works: user requests, its messages, commands with output, and file diffs. Each later message holds only what happened since the previous batch.`,
    "Review each batch for real problems: bugs, wrong or risky actions, claims the evidence does not support, missed requirements, and departures from what the user asked. Read files in the shared checkout when you need more context, but do not edit files, run commands that change state, or message other threads.",
    "Your reply is delivered to the reviewed agent, so make it short, specific, and actionable, with file:line references where you can. If nothing in the batch needs the agent's attention, reply with exactly LGTM and nothing is delivered.",
    ...brief,
  ].join("\n\n");
}

/** The message a reviewer receives; oversized batches keep the newest items. */
export function renderAutoreviewBatch(input: {
  readonly reviewedThread: Pick<OrchestrationV2AppThread, "id" | "title">;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly first: boolean;
  readonly brief?: string | undefined;
  /** Replaces the standard role text of the instructions. */
  readonly preamble?: string | undefined;
  /** The reviewer's own findings, left out of what it is shown. */
  readonly ownFindings?: ReadonlyArray<string> | undefined;
  /** Repeat the instructions on a later batch, after the brief or model changed. */
  readonly instructions?: boolean;
  /** Tool calls still running, listed after the activity. */
  readonly running?: ReadonlyArray<OrchestrationV2TurnItem> | undefined;
}): string {
  const preamble =
    input.first || input.instructions === true ? `${autoreviewInstructions(input)}\n\n` : "";
  const header = input.first
    ? `Activity so far in thread ${input.reviewedThread.id}:`
    : `New activity in thread ${input.reviewedThread.id} since your last batch:`;
  const rendered = input.items.flatMap((item) => {
    const text = renderReviewItem(item, input.ownFindings ?? []);
    return text === null ? [] : [text];
  });
  // On the first batch the opening request is kept even when earlier items are dropped.
  const pinned = input.first && input.items[0]?.type === "user_message" ? rendered[0] : undefined;
  const rest = pinned === undefined ? rendered : rendered.slice(1);
  const runningNote =
    (input.running?.length ?? 0) === 0
      ? undefined
      : clip(`### Running now\n${input.running!.map(runningLine).join("\n")}`, 3_000);
  const omittedNote = (count: number) =>
    `[${count} earlier item${count === 1 ? "" : "s"} omitted; read them with t3_thread_read on thread ${input.reviewedThread.id}.]`;
  let remaining =
    BATCH_MAX_CHARS -
    preamble.length -
    header.length -
    (pinned?.length ?? 0) -
    (runningNote?.length ?? 0) -
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
    ...(runningNote === undefined ? [] : [runningNote]),
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
  /** Into the live turn when its provider can take it, otherwise into the queue. */
  | { readonly type: "steer"; readonly targetRunId: OrchestrationV2Run["id"] }
  /** Added to the findings message already waiting in the queue. */
  | { readonly type: "append"; readonly queuedRunId: OrchestrationV2Run["id"] }
  | { readonly type: "queue" }
  | { readonly type: "start" }
  | { readonly type: "skip"; readonly reason: string };

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

/** The queued findings message that later findings join, if one is waiting. */
export const queuedFindingsRun = (runs: ReadonlyArray<OrchestrationV2Run>) =>
  runs.find((run) => run.status === "queued" && isAutoreviewFindingsMessageId(run.userMessageId));

/**
 * Findings steer the reviewed thread's live turn. Otherwise they join the findings message
 * already waiting in the queue, so the queue holds at most one, or queue behind other queued
 * work (a held queue keeps them held). On an idle thread they start a turn unless the user
 * stopped its last turn or findings already started too many turns in a row.
 */
export function planFindingsDelivery(
  runs: ReadonlyArray<OrchestrationV2Run>,
  /** Whether a Stop reached the newest executed run, even one that still completed. */
  latestRunStopped = false,
): FindingsDelivery {
  // A Stop holds the newest run, even while it is still stopping or after it completed:
  // findings wait for the next turn the user starts, instead of restarting the thread.
  if (latestRunStopped || latestExecutedRun(runs)?.status === "interrupted") {
    return { type: "skip", reason: "the thread was stopped; findings wait for its next turn" };
  }
  const active = runs
    .filter((run) => ACTIVE_RUN_STATUSES.has(run.status))
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
  if (active !== undefined) return { type: "steer", targetRunId: active.id };
  const waiting = queuedFindingsRun(runs);
  if (waiting !== undefined) return { type: "append", queuedRunId: waiting.id };
  if (runs.some((run) => run.status === "queued")) return { type: "queue" };
  if (consecutiveAutoreviewWakes(runs) >= MAX_CONSECUTIVE_AUTOREVIEW_WAKES) {
    return {
      type: "skip",
      reason: `findings already started ${MAX_CONSECUTIVE_AUTOREVIEW_WAKES} turns in a row`,
    };
  }
  return { type: "start" };
}
