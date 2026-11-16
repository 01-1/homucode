import type { OrchestrationMessageContext, OrchestrationMessageSentFrom } from "@t3tools/contracts";

/** Who stopped a run, as the interrupt notice names them in every client and in thread reads. */
export type StopActor = "human" | "agent" | "unknown";

const ACTOR_NAMES: Record<StopActor, string> = {
  human: "a human",
  agent: "an agent",
  unknown: "an unknown sender",
};

/** `Stopped by an agent`, or with a purpose, `Stopped by a human to send a new message`. */
export function stoppedBy(actor: StopActor, purpose?: string): string {
  return `Stopped by ${ACTOR_NAMES[actor]}${purpose === undefined ? "" : ` ${purpose}`}`;
}

/** Only the app's own surfaces stand for a person; the CLI is also what scripts and agents use. */
export function connectionStopActor(sentFrom: OrchestrationMessageSentFrom | undefined): StopActor {
  return sentFrom === undefined || sentFrom.surface === "cli" ? "unknown" : "human";
}

/** The sender of a message that stops the running turn, such as a restart or a bare "stop". */
export function messageStopActor(message: {
  readonly createdBy: string;
  readonly senderThreadId?: unknown;
  readonly linkedSender?: unknown;
  readonly scheduledTaskId?: unknown;
  readonly context?: OrchestrationMessageContext | undefined;
}): StopActor {
  if (message.senderThreadId !== undefined || message.linkedSender !== undefined) return "agent";
  if (message.scheduledTaskId !== undefined || message.createdBy !== "user") return "unknown";
  if (message.context?.guest !== undefined) return "human";
  return connectionStopActor(message.context?.sentFrom);
}
