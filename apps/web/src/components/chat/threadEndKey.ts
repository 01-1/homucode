import { isEditableFocused } from "../../lib/editableFocus";
import { TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR } from "./composerFocusRedirect";

const END_REPEAT_WINDOW_MS = 500;
const TIMELINE_SCROLL_SELECTOR = ".messages-timeline-scroll";
const THREAD_TEXT_FIELD_SELECTOR = '[data-testid="composer-editor"], [data-thread-find-bar] input';
// Widgets that move their own selection on End.
const END_KEY_WIDGET_SELECTOR = [
  '[role="grid"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="tablist"]',
  '[role="tree"]',
  '[role="treegrid"]',
].join(",");

/**
 * End jumps to the thread's end unless focus sits in something that scrolls or
 * navigates with End itself: a text field whose caret is not yet at the end, a
 * widget, or a scroller other than the timeline. An End within half a second
 * of one that it left alone is left alone too.
 */
export function endKeyScrollsThread(
  event: { readonly target: EventTarget | null; readonly timeStamp: number },
  lastUnusedEndAt: number,
): boolean {
  // A quick second End (or a held one) belongs to whatever took the first.
  if (event.timeStamp - lastUnusedEndAt < END_REPEAT_WINDOW_MS) return false;
  if (document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)) return false;
  const { target } = event;
  if (!(target instanceof Element) || target === document.body) return true;
  if (isEditableFocused(target))
    return target.matches(THREAD_TEXT_FIELD_SELECTOR) && isCaretAtFieldEnd(target);
  if (target.closest(END_KEY_WIDGET_SELECTOR)) return false;
  for (
    let node: Element | null = target;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (node.matches(TIMELINE_SCROLL_SELECTOR)) return true;
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
      return false;
  }
  return true;
}

function isCaretAtFieldEnd(field: Element): boolean {
  if (field instanceof HTMLInputElement) {
    return field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
  }
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.focusNode || !field.contains(selection.focusNode))
    return false;
  const rest = document.createRange();
  rest.setStart(selection.focusNode, selection.focusOffset);
  rest.setEnd(field, field.childNodes.length);
  return rest.toString() === "";
}
