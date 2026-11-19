import type {
  OrchestrationMessageSentFrom,
  OrchestrationV2Actor,
  OrchestrationV2CreationSource,
  OrchestrationV2Notification,
} from "@t3tools/contracts";

/** The fields of a user-role message that say who sent it. */
export interface MessageSourceFields {
  readonly createdBy?: OrchestrationV2Actor | undefined;
  readonly creationSource?: OrchestrationV2CreationSource | undefined;
  readonly scheduledTaskId?: string | undefined;
  readonly senderThreadId?: string | undefined;
  readonly linkedSender?: { readonly title: string } | undefined;
  readonly notification?: Pick<OrchestrationV2Notification, "source" | "summary"> | undefined;
  readonly context?:
    | {
        readonly sentFrom?: OrchestrationMessageSentFrom | undefined;
        readonly guest?: { readonly name: string } | undefined;
      }
    | undefined;
}

export type MessageSource =
  | {
      readonly kind: "human";
      /** Such as `my-phone (T3 mobile, Android, via relay)`; undefined when the client named none. */
      readonly device: string | undefined;
      readonly guestName?: string;
    }
  | {
      readonly kind: "automatic";
      /** What sent it, such as `a scheduled task` or `T3 Code`. */
      readonly sender: string;
      /** The same as a short UI label, such as `Scheduled task`. */
      readonly label: string;
      /** What happened, for messages T3 Code sent about an event. */
      readonly summary?: string;
    };

const SURFACE_LABELS: Record<OrchestrationMessageSentFrom["surface"], string> = {
  web: "T3 web",
  desktop: "T3 desktop",
  mobile: "T3 mobile",
  cli: "T3 CLI",
};

/** A device as people read it, such as `my-phone (T3 mobile, Android, Pixel 9, via relay)`. */
function sentFromDeviceLabel(
  sentFrom: OrchestrationMessageSentFrom,
  label = SURFACE_LABELS[sentFrom.surface],
): string {
  const details = [
    sentFrom.os === undefined || sentFrom.os === "unknown" || sentFrom.os === "other"
      ? undefined
      : sentFrom.os,
    sentFrom.deviceModel ?? (sentFrom.deviceType === "phone" ? "phone" : undefined),
    sentFrom.deviceType === "tablet" && sentFrom.deviceModel === undefined ? "tablet" : undefined,
    sentFrom.surface === "web" ? sentFrom.browser : undefined,
    sentFrom.connectionMethod === "relay" || sentFrom.connectionMethod === "ssh"
      ? `via ${sentFrom.connectionMethod}`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  if (sentFrom.deviceName !== undefined) {
    return `${sentFrom.deviceName} (${[label, ...details].join(", ")})`;
  }
  return details.length === 0 ? label : `${label} (${details.join(", ")})`;
}

const NOTIFICATION_SENDERS: Record<
  OrchestrationV2Notification["source"]["kind"],
  readonly [sender: string, label: string]
> = {
  delegated_task: ["a delegated task's result", "Delegated task"],
  subagent: ["a subagent's result", "Subagent"],
  command: ["a background command", "Background command"],
  monitor: ["a pull request watch", "Pull request watch"],
  background_task: ["background work", "Background work"],
  system: ["T3 Code", "T3 Code"],
};

/**
 * Who sent a user-role message. Only a person at a client sends a human message; scheduled tasks,
 * other agents, scripts using `t3 thread send`, and T3 Code itself send automatic ones.
 */
export function messageSource(message: MessageSourceFields): MessageSource {
  const guest = message.context?.guest;
  const sentFrom = message.context?.sentFrom;
  if (message.scheduledTaskId !== undefined) {
    return { kind: "automatic", sender: "a scheduled task", label: "Scheduled task" };
  }
  if (message.notification !== undefined) {
    const [sender, label] = NOTIFICATION_SENDERS[message.notification.source.kind];
    return { kind: "automatic", sender, label, summary: message.notification.summary };
  }
  if (message.senderThreadId !== undefined) {
    return {
      kind: "automatic",
      sender: `the agent in thread ${message.senderThreadId}`,
      label: "Agent",
    };
  }
  if (message.linkedSender !== undefined) {
    return {
      kind: "automatic",
      sender: `an agent on a linked machine (thread "${message.linkedSender.title}")`,
      label: "Agent on a linked machine",
    };
  }
  if (message.createdBy === "user" || message.createdBy === undefined) {
    return {
      kind: "human",
      device: sentFrom === undefined ? undefined : sentFromDeviceLabel(sentFrom),
      ...(guest === undefined ? {} : { guestName: guest.name }),
    };
  }
  if (message.creationSource === "mcp") {
    return {
      kind: "automatic",
      sender: "an agent or script using T3's tools",
      label: "Agent or script",
    };
  }
  return { kind: "automatic", sender: "T3 Code", label: "T3 Code" };
}

/** The line the agent reads after a message, naming who sent it. */
export function messageSourceLine(message: MessageSourceFields): string {
  const source = messageSource(message);
  if (source.kind === "human") {
    const who = source.guestName === undefined ? "A human" : `A human guest (${source.guestName})`;
    return `[T3] Sent from: ${source.device ?? "unknown device"}. ${who} sent this message.`;
  }
  const summary = source.summary === undefined ? "" : `: ${source.summary}`;
  return `[T3] Automatic message from ${source.sender}${summary}. No human sent this message.`;
}

/** The short line people see over a message, such as `Human · my-phone (Homu mobile)`. */
export function messageSourceLabel(message: MessageSourceFields): string {
  const source = messageSource(message);
  if (source.kind === "automatic") {
    return `Automatic · ${source.label === "T3 Code" ? "HomuCode" : source.label}`;
  }
  const who = source.guestName === undefined ? "Human" : "Human guest";
  const sentFrom = message.context?.sentFrom;
  if (sentFrom === undefined) return who;
  const surfaceLabel = sentFrom.surface === "cli" ? SURFACE_LABELS.cli : `Homu ${sentFrom.surface}`;
  return `${who} · ${sentFromDeviceLabel(sentFrom, surfaceLabel)}`;
}
