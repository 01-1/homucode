import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { SKILL_MENTION_PATTERN } from "@t3tools/shared/composerInlineTokens";

const leadingSkillMention = new RegExp(`^\\s*${SKILL_MENTION_PATTERN.source}`, "u");

/** Provider-only formatting: stored text stays bare and queued messages retain their send time. */
export function withMessageTimestamp(
  text: string,
  message: Pick<OrchestrationV2ConversationMessage, "text" | "createdAt">,
): string {
  // Providers parse commands and skills at the start of the original prompt.
  if (message.text.trimStart().startsWith("/") || leadingSkillMention.test(message.text))
    return text;
  const sent = new Date(DateTime.toEpochMillis(message.createdAt));
  const pad = (value: number) => String(value).padStart(2, "0");
  const prefix = `${sent.getFullYear()}-${pad(sent.getMonth() + 1)}-${pad(sent.getDate())}T${pad(sent.getHours())}:${pad(sent.getMinutes())}:${pad(sent.getSeconds())}: `;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}
