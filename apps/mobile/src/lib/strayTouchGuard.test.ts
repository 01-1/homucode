import { expect, it, vi } from "vite-plus/test";

import { STRAY_TOUCH_GUARD_MS, holdTouches, touchesHeld } from "./strayTouchGuard";

it("holds touches when a surface appears, once per surface, until the guard passes", () => {
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => void vi.useRealTimers() };
  vi.advanceTimersByTime(STRAY_TOUCH_GUARD_MS);
  expect(touchesHeld()).toBe(false);

  holdTouches("question-1");
  expect(touchesHeld()).toBe(true);
  vi.advanceTimersByTime(STRAY_TOUCH_GUARD_MS);
  expect(touchesHeld()).toBe(false);

  // A card that remounts, such as one scrolled back into view, is not new.
  holdTouches("question-1");
  expect(touchesHeld()).toBe(false);
  holdTouches("question-2");
  expect(touchesHeld()).toBe(true);
  vi.advanceTimersByTime(STRAY_TOUCH_GUARD_MS);

  // Startup holds without naming a surface, every time.
  holdTouches();
  holdTouches();
  expect(touchesHeld()).toBe(true);
});
