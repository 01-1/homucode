import {
  type OrchestrationV2UserInputQuestion,
  type UserInputAttachmentAnswerPayload,
} from "@t3tools/contracts";
import { composerContextProviderTextForDisplay } from "@t3tools/shared/composerContextReferences";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getQuestionAnswerText(value: unknown): string {
  // Answers holding context chips are stored in provider form.
  if (typeof value === "string") return composerContextProviderTextForDisplay(value);
  if (Array.isArray(value)) return value.map(getQuestionAnswerText).filter(Boolean).join(", ");
  const nested = record(value);
  return nested ? getQuestionAnswerText(nested.answers) : "";
}

export function getQuestionTextPreview(answer: UserInputAttachmentAnswerPayload): string {
  return Object.values(answer.questionTextById ?? {})
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

export function getQuestionAnswerPreview(answer: UserInputAttachmentAnswerPayload): string {
  const answers = Object.values(answer.answers).map(getQuestionAnswerText).filter(Boolean);
  const attachments = Object.values(answer.attachmentsByQuestionId)
    .flat()
    .map((attachment) => attachment.name);
  return (
    answers.length > 0
      ? answers.join(" · ")
      : attachments.length > 0
        ? attachments.join(", ")
        : Object.values(answer.questionTextById ?? {}).join(" · ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function hasQuestionAnswer(answer: UserInputAttachmentAnswerPayload): boolean {
  return (
    Object.values(answer.answers).some(getQuestionAnswerText) ||
    Object.values(answer.attachmentsByQuestionId).some((attachments) => attachments.length > 0)
  );
}

function answerStrings(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(answerStrings);
  const nested = record(value);
  return nested ? answerStrings(nested.answers) : [];
}

/** Splits an answer into the option labels it picked and any typed text. */
export function getQuestionAnswerSelection(
  question: Pick<OrchestrationV2UserInputQuestion, "options" | "multiSelect">,
  value: unknown,
): { readonly selectedLabels: ReadonlySet<string>; readonly customText: string } {
  const labels = new Set(question.options.map((option) => option.label));
  const selectedLabels = new Set<string>();
  const custom: string[] = [];
  for (const text of answerStrings(value)) {
    const trimmed = text.trim();
    // Claude joins multi-select labels with ", " before they reach the provider.
    const parts = question.multiSelect ? trimmed.split(", ") : [trimmed];
    if (labels.has(trimmed)) selectedLabels.add(trimmed);
    else if (parts.length > 1 && parts.every((part) => labels.has(part)))
      for (const part of parts) selectedLabels.add(part);
    else custom.push(getQuestionAnswerText(text));
  }
  return { selectedLabels, customText: custom.filter(Boolean).join(", ") };
}
