import { useGT } from "gt-react";
import type { OrchestrationV2UserInputQuestion } from "@t3tools/contracts";
import { getQuestionAnswerSelection } from "@t3tools/client-runtime/work-log/user-input";
import { CheckIcon } from "lucide-react";
import { textDirection } from "~/textDirection";
import { cn } from "~/lib/utils";

export function QuestionOptionsHistory({
  question,
  answer,
}: {
  readonly question: OrchestrationV2UserInputQuestion;
  readonly answer?: unknown;
}) {
  const gt = useGT();
  const { selectedLabels, customText } = getQuestionAnswerSelection(question, answer);
  return (
    <div className="space-y-1">
      <p className="whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">
        {question.question}
      </p>
      {question.options.length > 0 ? (
        <ul className="space-y-1">
          {question.options.map((option) => {
            const selected = selectedLabels.has(option.label);
            return (
              <li key={option.value ?? option.label} className="flex items-start gap-2">
                <span className="flex h-5 w-3 shrink-0 items-center justify-center">
                  {selected ? (
                    <CheckIcon aria-label={gt("Chosen")} className="size-3 text-foreground" />
                  ) : (
                    <span aria-hidden className="size-1 rounded-full bg-icon-muted" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p
                    className={cn(
                      "text-sm",
                      selected ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                    dir={textDirection(option.label)}
                  >
                    {option.label}
                  </p>
                  {option.description && option.description !== option.label ? (
                    <p
                      className="whitespace-pre-wrap text-2xs text-secondary-label"
                      dir={textDirection(option.description)}
                    >
                      {option.description}
                    </p>
                  ) : null}
                  {option.preview ? (
                    <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed text-secondary-label select-text">
                      {option.preview}
                    </pre>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {customText ? (
        <p className="ms-5 whitespace-pre-wrap text-sm text-foreground" dir="auto">
          {customText}
        </p>
      ) : null}
    </div>
  );
}
