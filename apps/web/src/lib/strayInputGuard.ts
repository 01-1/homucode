// Drops presses and keys aimed at the UI as it was a moment ago: something appeared, moved or
// took focus without being asked for, or the app only just started.
export const STRAY_INPUT_GUARD_MS = 500;
// A change this soon after the user's own press or command key is taken as its response.
const ASKED_FOR_MS = 1000;
// Focus that moves this soon after a press or key is that input's own default action.
const OWN_FOCUS_MS = 100;

// Marks a surface that shows up on its own (a question, an approval, an offer dialog).
// `data-unprompted="contents"` also covers controls that later appear inside it, such as the
// next question after an answer.
const UNPROMPTED = "[data-unprompted]";
const UNPROMPTED_CONTENTS = '[data-unprompted="contents"]';
const ACTIONABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
  ...[
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "checkbox",
    "radio",
    "switch",
    "treeitem",
  ].map((role) => `[role="${role}"]`),
].join(",");
const TEXT_ENTRY = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
// Touch presses arrive as pointerdown plus touch events, compatibility mouse events and click.
const PRESS_FOLLOWUPS = ["pointerup", "mousedown", "mouseup", "contextmenu"];
// Keyboard activation also fires click, with detail 0; only pointer clicks belong to a press.
const PRESS_CLICKS = ["click", "dblclick", "auxclick"];
const PRESS_TOUCHES = ["touchstart", "touchend"];

function actionableAt(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(ACTIONABLE) : null;
}

function holdsControls(element: Element): boolean {
  return element.matches(ACTIONABLE) || element.querySelector(ACTIONABLE) !== null;
}

function isTextEditingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== "Backspace" && event.key !== "Delete" && event.key.length !== 1) return false;
  return event.target instanceof Element && event.target.closest(TEXT_ENTRY) !== null;
}

function swallow(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installStrayInputGuard(): Disposable {
  const now = () => performance.now();
  const startedAt = now();
  const appearedAt = new WeakMap<Node, number>();
  let askedAt = Number.NEGATIVE_INFINITY;
  let pressedAt = Number.NEGATIVE_INFINITY;
  let keyedAt = Number.NEGATIVE_INFINITY;
  let typedAt = Number.NEGATIVE_INFINITY;
  let unpromptedAt = Number.NEGATIVE_INFINITY;
  let focusMovedAt = Number.NEGATIVE_INFINITY;
  let pointer: { x: number; y: number } | null = null;
  let hovered: Element | null = null;
  let hoveredChangedAt = Number.NEGATIVE_INFINITY;
  let hitTestFrame: number | null = null;
  let swallowingPress = false;
  const swallowedKeys = new Set<string>();

  const recent = (time: number) => now() - time < STRAY_INPUT_GUARD_MS;
  const asked = () => now() - askedAt < ASKED_FOR_MS;
  const appearedRecently = (target: EventTarget | null) => {
    for (let node = target instanceof Node ? target : null; node; node = node.parentNode) {
      const time = appearedAt.get(node);
      if (time !== undefined && recent(time)) return true;
    }
    return false;
  };

  const appeared = (element: Element, time: number) => {
    const unprompted =
      element.matches(UNPROMPTED) ||
      element.querySelector(UNPROMPTED) !== null ||
      (element.parentElement?.closest(UNPROMPTED_CONTENTS) != null && holdsControls(element));
    // Typing asks for what it opens, such as the composer's suggestions, but not for focus moves.
    if (!unprompted && (asked() || now() - typedAt < ASKED_FOR_MS)) return;
    appearedAt.set(element, time);
    if (unprompted) unpromptedAt = time;
  };

  const hitTest = () => {
    hitTestFrame = null;
    if (!pointer) return;
    const next = actionableAt(document.elementFromPoint(pointer.x, pointer.y));
    if (next === hovered) return;
    hovered = next;
    if (!asked()) hoveredChangedAt = now();
  };
  const scheduleHitTest = () => {
    if (pointer && hitTestFrame === null) hitTestFrame = requestAnimationFrame(hitTest);
  };

  const recordChanges = (records: MutationRecord[]) => {
    const time = now();
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof Element) appeared(record.target, time);
        continue;
      }
      for (const node of record.addedNodes) if (node instanceof Element) appeared(node, time);
    }
    scheduleHitTest();
  };
  const observer = new MutationObserver(recordChanges);
  // A control can mount and take focus or a press in the same task, before the observer runs.
  const recordPending = () => recordChanges(observer.takeRecords());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "hidden",
      "open",
      "data-open",
      "aria-hidden",
      "inert",
      "disabled",
      "aria-disabled",
    ],
  });

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    // Chromium sends moves without movement after layout changes; those are not the user aiming.
    if (pointer?.x === event.clientX && pointer.y === event.clientY) return;
    pointer = { x: event.clientX, y: event.clientY };
    const next = actionableAt(event.target);
    if (next === hovered) return;
    hovered = next;
    hoveredChangedAt = Number.NEGATIVE_INFINITY;
  };
  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget === null) pointer = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isTrusted) return;
    recordPending();
    if (hitTestFrame !== null) {
      cancelAnimationFrame(hitTestFrame);
      hitTest();
    }
    const stray =
      recent(startedAt) ||
      appearedRecently(event.target) ||
      (recent(hoveredChangedAt) && actionableAt(event.target) === hovered);
    swallowingPress = stray;
    if (stray) {
      swallow(event);
      return;
    }
    askedAt = pressedAt = now();
  };
  const onPressFollowup = (event: Event) => {
    if (event.isTrusted && swallowingPress) swallow(event);
  };
  const onPressClick = (event: MouseEvent) => {
    if (event.detail > 0) onPressFollowup(event);
  };
  // Touch listeners on window are passive, so these can only be stopped, not prevented.
  const onPressTouch = (event: TouchEvent) => {
    if (event.isTrusted && swallowingPress) event.stopImmediatePropagation();
  };
  const onWheel = () => {
    askedAt = now();
  };

  const onFocusIn = (event: FocusEvent) => {
    recordPending();
    const time = now();
    const own = time - pressedAt < OWN_FOCUS_MS || time - keyedAt < OWN_FOCUS_MS;
    if (appearedRecently(event.target) || (!own && !asked())) focusMovedAt = time;
    else if (own) focusMovedAt = Number.NEGATIVE_INFINITY;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.isTrusted || event.isComposing) return;
    // A key ends any dropped press, so keyboard context menus and clicks are its own.
    swallowingPress = false;
    if (MODIFIER_KEYS.has(event.key)) return;
    if (event.repeat && swallowedKeys.has(event.code)) {
      swallow(event);
      return;
    }
    const textEditing = isTextEditingKey(event);
    const stray =
      recent(startedAt) || recent(focusMovedAt) || (!textEditing && recent(unpromptedAt));
    if (stray) {
      swallowedKeys.add(event.code);
      swallow(event);
      return;
    }
    if (textEditing) typedAt = now();
    else askedAt = keyedAt = now();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (swallowedKeys.delete(event.code)) swallow(event);
  };

  const listeners: Array<[string, EventListener, AddEventListenerOptions]> = [
    ["pointermove", onPointerMove as EventListener, { capture: true, passive: true }],
    ["pointerout", onPointerOut as EventListener, { capture: true, passive: true }],
    ["pointerdown", onPointerDown as EventListener, { capture: true }],
    ...PRESS_FOLLOWUPS.map((type): [string, EventListener, AddEventListenerOptions] => [
      type,
      onPressFollowup,
      { capture: true },
    ]),
    ...PRESS_CLICKS.map((type): [string, EventListener, AddEventListenerOptions] => [
      type,
      onPressClick as EventListener,
      { capture: true },
    ]),
    ...PRESS_TOUCHES.map((type): [string, EventListener, AddEventListenerOptions] => [
      type,
      onPressTouch as EventListener,
      { capture: true, passive: true },
    ]),
    ["wheel", onWheel, { capture: true, passive: true }],
    ["scroll", scheduleHitTest, { capture: true, passive: true }],
    ["resize", scheduleHitTest, { passive: true }],
    ["focusin", onFocusIn as EventListener, { capture: true }],
    ["keydown", onKeyDown as EventListener, { capture: true }],
    ["keyup", onKeyUp as EventListener, { capture: true }],
  ];
  for (const [type, listener, options] of listeners)
    window.addEventListener(type, listener, options);

  return {
    [Symbol.dispose]() {
      observer.disconnect();
      if (hitTestFrame !== null) cancelAnimationFrame(hitTestFrame);
      for (const [type, listener, options] of listeners) {
        window.removeEventListener(type, listener, options);
      }
    },
  };
}
