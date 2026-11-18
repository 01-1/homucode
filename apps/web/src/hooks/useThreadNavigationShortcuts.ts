import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import {
  resolveAdjacentThreadId,
  threadShortcutContext,
  useThreadJumpHintsVisible,
} from "../components/Sidebar.logic";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useStableCallback } from "./useStableCallback";

const NO_JUMP_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * Previous/next thread and jump to thread 1 to 9 over a list's visible rows, by thread key.
 * Returns the jump hint for each row, filled only while the hint modifiers are held.
 */
export function useThreadNavigationShortcuts(input: {
  readonly orderedThreadKeys: readonly string[];
  readonly currentThreadKey: string | null;
  readonly routeThreadRef: ScopedThreadRef | null;
  /** Opens the row; false when the key no longer names a thread. */
  readonly onNavigate: (threadKey: string) => boolean;
}): ReadonlyMap<string, string> {
  const { orderedThreadKeys, currentThreadKey, routeThreadRef } = input;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const navigate = useStableCallback(input.onNavigate);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window keydown for thread navigation shortcuts using the current thread list
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: threadShortcutContext(routeThreadRef),
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey || !navigate(targetThreadKey)) return;
        event.preventDefault();
        event.stopPropagation();
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: currentThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [currentThreadKey, keybindings, navigate, orderedThreadKeys, routeThreadRef]);

  const showJumpHints = useThreadJumpHintsVisible(keybindings, routeThreadRef);
  if (!showJumpHints) return NO_JUMP_LABELS;
  const labels = new Map<string, string>();
  for (const [index, threadKey] of orderedThreadKeys.entries()) {
    const jumpCommand = threadJumpCommandForIndex(index);
    if (!jumpCommand) break;
    const label = shortcutLabelForCommand(keybindings, jumpCommand);
    if (label) labels.set(threadKey, label);
  }
  return labels;
}
