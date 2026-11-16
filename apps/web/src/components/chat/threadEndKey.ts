import { TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR } from "./composerFocusRedirect";

const TIMELINE_SCROLL_SELECTOR = ".messages-timeline-scroll";
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
 * navigates with End itself: a widget, or a scroller other than the timeline.
 */
export function endKeyScrollsThread(target: EventTarget | null): boolean {
  if (document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)) return false;
  if (!(target instanceof Element) || target === document.body) return true;
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
