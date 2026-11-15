import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  type OrchestrationV2Autoreviewer,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { randomUUID } from "../../lib/utils";

import { useQuietThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";

function ReviewerControl({
  threadRef,
  reviewer,
}: {
  threadRef: ScopedThreadRef;
  reviewer: OrchestrationV2Autoreviewer;
}) {
  const child = useQuietThreadShell({
    environmentId: threadRef.environmentId,
    threadId: reviewer.threadId,
  });
  const allowed = useAtomValue(
    threadEnvironment.stopAutoreviewer.permissionAtom(threadRef.environmentId),
  );
  const stop = useOrchestrationCommand(threadEnvironment.stopAutoreviewer, {
    reportFailure: false,
  });
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = child?.title || "Autoreviewer";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <Button
        size="compact"
        variant="ghost-destructive"
        disabled={!allowed || stopping}
        aria-label={`Stop autoreviewer ${title}`}
        title="Stop this reviewer and its delegated work, and remove its attachment. History is kept."
        onClick={async () => {
          if (!allowed || stopping) return;
          setStopping(true);
          setError(null);
          try {
            const result = await stop({
              environmentId: threadRef.environmentId,
              input: {
                commandId: CommandId.make(randomUUID()),
                threadId: threadRef.threadId,
                reviewerThreadId: reviewer.threadId,
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const failure = squashAtomCommandFailure(result);
              setError(
                failure instanceof Error ? failure.message : "Could not stop the autoreviewer.",
              );
            }
          } finally {
            setStopping(false);
          }
        }}
      >
        {stopping ? "Stopping…" : "Stop autoreviewer"}
      </Button>
      {error !== null ? (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AutoreviewerControls({
  threadRef,
  reviewers,
}: {
  threadRef: ScopedThreadRef | null;
  reviewers: ReadonlyArray<OrchestrationV2Autoreviewer>;
}) {
  if (threadRef === null || reviewers.length === 0) return null;
  return (
    <section aria-label="Attached autoreviewers" className="mb-2 flex flex-col gap-1">
      {reviewers.map((reviewer) => (
        <ReviewerControl
          key={JSON.stringify([threadRef.environmentId, threadRef.threadId, reviewer.threadId])}
          threadRef={threadRef}
          reviewer={reviewer}
        />
      ))}
    </section>
  );
}
