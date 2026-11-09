import {
  OrchestrationMessageSentFrom,
  type OrchestrationMessageContext,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeSentFrom = Schema.decodeUnknownOption(OrchestrationMessageSentFrom);

/**
 * The client a socket's user messages come from, read from what the socket declared when it
 * connected (`readClientAnalyticsProps` in ws.ts). Undefined when it named no known surface.
 */
export function sentFromConnection(
  props: Readonly<Record<string, unknown>>,
): OrchestrationMessageSentFrom | undefined {
  const candidate = {
    surface: props.surface,
    os: props.clientOs,
    deviceType: props.clientDeviceType,
    deviceModel: props.deviceModel,
    browser: props.clientBrowser,
    connectionMethod: props.connectionMethod,
  };
  // Drop each field that does not decode on its own, so one odd value keeps the rest.
  const fields = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        value !== undefined &&
        (key === "surface" || decodeSentFrom({ surface: "web", [key]: value })._tag === "Some"),
    ),
  );
  const decoded = decodeSentFrom(fields);
  return decoded._tag === "Some" ? decoded.value : undefined;
}

function withContextSentFrom(
  context: OrchestrationMessageContext | undefined,
  sentFrom: OrchestrationMessageSentFrom | undefined,
): OrchestrationMessageContext | undefined {
  const { sentFrom: _claimed, ...rest } = context ?? { version: 1 as const, records: [] };
  if (sentFrom !== undefined) return { ...rest, sentFrom };
  return context === undefined ? undefined : rest;
}

/** Stamps a client's message with its socket's device, replacing any the client claimed. */
export function withConnectionSentFrom(
  command: OrchestrationV2Command,
  sentFrom: OrchestrationMessageSentFrom | undefined,
): OrchestrationV2Command {
  if (command.type !== "message.dispatch") return command;
  const context = withContextSentFrom(command.context, sentFrom);
  const { context: _context, ...rest } = command;
  return context === undefined ? rest : { ...rest, context };
}

/** Only a user's own message carries a device; anything else that claims one loses it. */
export function withoutNonUserSentFrom<
  C extends {
    readonly createdBy: string;
    readonly context?: OrchestrationMessageContext | undefined;
  },
>(command: C): C {
  if (command.createdBy === "user" || command.context?.sentFrom === undefined) return command;
  const { sentFrom: _sentFrom, ...context } = command.context;
  return { ...command, context };
}

const SURFACE_LABELS: Record<OrchestrationMessageSentFrom["surface"], string> = {
  web: "T3 web",
  desktop: "T3 desktop",
  mobile: "T3 mobile",
  cli: "T3 CLI",
};

/**
 * The line the agent reads with a user's message, such as
 * `[T3] Sent from: T3 mobile (iOS, iPhone 16 Pro, via relay)`. Empty for messages an agent,
 * a scheduled task, or T3 itself sent, and for messages from clients that named no surface.
 */
type SentMessage = Pick<
  OrchestrationV2ConversationMessage,
  "createdBy" | "context" | "scheduledTaskId" | "senderThreadId"
>;

export function sentFromLine(message: SentMessage): string {
  const sentFrom = message.context?.sentFrom;
  if (
    message.createdBy !== "user" ||
    message.scheduledTaskId !== undefined ||
    message.senderThreadId !== undefined ||
    sentFrom === undefined
  ) {
    return "";
  }
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
  const label = SURFACE_LABELS[sentFrom.surface];
  return `[T3] Sent from: ${details.length === 0 ? label : `${label} (${details.join(", ")})`}`;
}

/**
 * The prompt with its device line after it. Slash commands go verbatim, since providers parse
 * them from the start and end of the prompt.
 */
export function withSentFromLine(text: string, message: SentMessage): string {
  const line = sentFromLine(message);
  if (line === "" || text.trimStart().startsWith("/")) return text;
  return text === "" ? line : `${text}\n\n${line}`;
}
