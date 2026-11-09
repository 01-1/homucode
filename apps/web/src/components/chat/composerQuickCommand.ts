import type { ModelSelection } from "@t3tools/contracts";
import { parseQuickCommand } from "@t3tools/shared/composerTrigger";

export type QuickCommandSend =
  | { readonly kind: "none" }
  | { readonly kind: "blocked"; readonly title: string; readonly description: string }
  | { readonly kind: "send"; readonly question: string; readonly modelSelection: ModelSelection };

/**
 * What a send does with a `/q` message. It sends only the question, on the quick model, for one
 * turn: the thread keeps its own model, so the next message goes back to it. On another provider
 * the turn gets the usual provider-switch handoff, and the return resumes the thread's own native
 * conversation with just the turns it missed.
 */
export function resolveQuickCommandSend(input: {
  readonly prompt: string;
  readonly quickModelSelection: ModelSelection | null;
  /** A thread that has not started yet would take the quick model as its own. */
  readonly threadStarted: boolean;
}): QuickCommandSend {
  const command = parseQuickCommand(input.prompt);
  if (command === null) return { kind: "none" };
  if (command.question === "") {
    return {
      kind: "blocked",
      title: "Nothing to ask",
      description: "Type a question after /q.",
    };
  }
  if (input.quickModelSelection === null) {
    return {
      kind: "blocked",
      title: "No quick model",
      description: "Pick a quick model in Settings → Threads to use /q.",
    };
  }
  if (!input.threadStarted) {
    return {
      kind: "blocked",
      title: "Start the thread first",
      description: "/q answers in a thread that has already started. Send a first message.",
    };
  }
  return { kind: "send", question: command.question, modelSelection: input.quickModelSelection };
}
