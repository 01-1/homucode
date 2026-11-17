import { MessageId } from "@t3tools/contracts";
import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { useEffect, useRef } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { ComposerSubmissionIntent } from "../../composer-logic";
import {
  composerDraftHasUserContent,
  DraftId,
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "../../composerDraftStore";
import type { ChatMessage } from "../../types";
import { optimisticMessageAttachments } from "../ChatView.logic";
import { draftSendState } from "./chatViewSend";

interface HeldSendMeta {
  readonly dispatchMode: ComposerDispatchMode;
  readonly submissionIntent: ComposerSubmissionIntent;
  readonly messageId: MessageId;
  readonly createdAt: string;
}

// The held draft persists with the other drafts; how it was sent lives only for the session.
const heldSendMetaByRouteKey = new Map<string, HeldSendMeta>();

const heldDraftId = (routeThreadKey: string) => DraftId.make(`held-send:${routeThreadKey}`);
// What the user was typing when the held message went back into the composer to send.
const stashDraftId = (routeThreadKey: string) => DraftId.make(`held-send-stash:${routeThreadKey}`);

interface AdvanceState {
  readonly blocked: boolean;
  readonly enabled: boolean;
  readonly held: boolean;
  readonly stashed: boolean;
  readonly composer: boolean;
}

export type HeldSendFn = (
  event: undefined,
  dispatchMode: ComposerDispatchMode,
  submissionIntent: ComposerSubmissionIntent,
) => Promise<unknown>;

/**
 * A message sent while the previous one is still sending waits here, shown as the pending
 * message its queue or steer choice makes, and sends itself once the previous one settles.
 */
export function useHeldSend(input: {
  readonly routeThreadKey: string;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly enabled: boolean;
  readonly sendBlocked: boolean;
  readonly syncComposer: (prompt: string) => void;
  readonly sendRef: { readonly current: HeldSendFn | null };
}) {
  const { routeThreadKey, composerDraftTarget, enabled, sendBlocked, syncComposer, sendRef } =
    input;
  const heldTarget = heldDraftId(routeThreadKey);
  const stashTarget = stashDraftId(routeThreadKey);
  const heldDraft = useComposerDraftStore((store) => store.getComposerDraft(heldTarget));
  const stashHasContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(stashTarget)),
  );
  const composerHasContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget)),
  );
  const heldHasContent = composerDraftHasUserContent(heldDraft);
  const replayRef = useRef<HeldSendMeta | null>(null);

  const meta = heldSendMetaByRouteKey.get(routeThreadKey);
  const heldMessage: ChatMessage | null =
    heldHasContent && heldDraft
      ? {
          id: meta?.messageId ?? MessageId.make(`held-send:${routeThreadKey}`),
          role: "user",
          text: heldDraft.prompt,
          ...(heldDraft.images.length + heldDraft.files.length > 0
            ? {
                attachments: optimisticMessageAttachments([
                  ...heldDraft.images,
                  ...heldDraft.files,
                ]),
              }
            : {}),
          runId: null,
          createdAt: meta?.createdAt ?? new Date(0).toISOString(),
          updatedAt: meta?.createdAt ?? new Date(0).toISOString(),
          streaming: false,
          waitingForPreviousSend: true,
          ...(meta?.dispatchMode === "queue"
            ? { inputIntent: "queued_turn" as const }
            : meta?.dispatchMode === "steer"
              ? { inputIntent: "steer" as const }
              : {}),
        }
      : null;

  /** Takes the composer's draft to send later; false when it cannot wait here. */
  const hold = (
    dispatchMode: ComposerDispatchMode,
    submissionIntent: ComposerSubmissionIntent,
  ): boolean => {
    if (!enabled) return false;
    const store = useComposerDraftStore.getState();
    if (composerDraftHasUserContent(store.getComposerDraft(heldTarget))) return false;
    if (!composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget))) return false;
    store.moveComposerContent(composerDraftTarget, heldTarget);
    if (!composerDraftHasUserContent(store.getComposerDraft(heldTarget))) return false;
    const now = new Date().toISOString();
    heldSendMetaByRouteKey.set(routeThreadKey, {
      dispatchMode,
      submissionIntent,
      messageId: MessageId.make(`held-send:${routeThreadKey}:${now}`),
      createdAt: now,
    });
    syncComposer("");
    return true;
  };

  const advance = useStableCallback((state: AdvanceState) => {
    const replay = replayRef.current;
    if (replay !== null) {
      replayRef.current = null;
      void sendRef.current?.(undefined, replay.dispatchMode, replay.submissionIntent);
      return;
    }
    const store = useComposerDraftStore.getState();
    const blocked = state.blocked || draftSendState(routeThreadKey).sendInFlight.current;
    if (state.held && state.enabled && !blocked) {
      if (state.composer) store.moveComposerContent(composerDraftTarget, stashTarget);
      if (composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget))) return;
      store.moveComposerContent(heldTarget, composerDraftTarget);
      // Sent on the next render, once the composer shows the moved draft.
      replayRef.current = heldSendMetaByRouteKey.get(routeThreadKey) ?? {
        dispatchMode: "auto",
        submissionIntent: "foreground",
        messageId: MessageId.make(`held-send:${routeThreadKey}`),
        createdAt: new Date().toISOString(),
      };
      heldSendMetaByRouteKey.delete(routeThreadKey);
      syncComposer(store.getComposerDraft(composerDraftTarget)?.prompt ?? "");
      return;
    }
    if (state.stashed && !state.held && !state.composer) {
      store.moveComposerContent(stashTarget, composerDraftTarget);
      syncComposer(store.getComposerDraft(composerDraftTarget)?.prompt ?? "");
    }
  });
  const advanceState: AdvanceState = {
    blocked: sendBlocked,
    enabled,
    held: heldHasContent,
    stashed: stashHasContent,
    composer: composerHasContent,
  };
  // A send's in-flight flag is a ref, so its end is reported here rather than by a render.
  const onSendSettled = useStableCallback(() => advance(advanceState));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the held draft back and sends it once the previous send settles, which the draft store reports
  useEffect(() => {
    advance({
      blocked: sendBlocked,
      enabled,
      held: heldHasContent,
      stashed: stashHasContent,
      composer: composerHasContent,
    });
  }, [advance, sendBlocked, enabled, heldHasContent, stashHasContent, composerHasContent]);

  return { heldMessage, hold, onSendSettled };
}
