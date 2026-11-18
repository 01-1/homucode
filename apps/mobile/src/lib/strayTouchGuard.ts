import { useLayoutEffect } from "react";

// Touches this soon after startup or after a surface shows up on its own were aimed at what
// was there before, so the root view claims them before any control can respond.
export const STRAY_TOUCH_GUARD_MS = 500;
let heldUntil = 0;
let heldFor: unknown;

/** A surface that remounts, such as a card scrolled back into view, holds touches only once. */
export function holdTouches(surface?: unknown): void {
  if (surface !== undefined && surface === heldFor) return;
  heldFor = surface;
  heldUntil = Math.max(heldUntil, performance.now() + STRAY_TOUCH_GUARD_MS);
}

export function touchesHeld(): boolean {
  return performance.now() < heldUntil;
}

/** Holds touches whenever an unprompted surface (a question, an approval, an offer) appears. */
export function useHoldTouchesOnAppear(surface: unknown): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the hold in the commit that shows the surface
  useLayoutEffect(() => holdTouches(surface), [surface]);
}
