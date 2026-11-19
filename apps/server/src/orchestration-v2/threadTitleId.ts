// Title IDs: the title's first letter, plus a base-10 number on a collision (F, F1, F2).
// Settled threads add letters (F1a); unsettling returns to their own number if free, else the lowest
// free one. The initial comes from the title, so digit initials ("7", "71") stay unambiguous.

const FIRST_CHARACTER = /[\p{L}\p{N}]/u;
const ID_REST = /^(\d*)([a-z]*)$/;

/** The title's first letter or digit, upper-cased; undefined when it has none. */
export function threadTitleInitial(title: string): string | undefined {
  return title.match(FIRST_CHARACTER)?.[0]?.toLocaleUpperCase();
}

/** a, b, ... z, aa, ab, ... */
function letters(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function lowestFreeActive(initial: string, taken: Pick<ReadonlySet<string>, "has">): string {
  if (!taken.has(initial)) return initial;
  for (let number = 1; ; number += 1) {
    if (!taken.has(`${initial}${number}`)) return `${initial}${number}`;
  }
}

function lowestFreeSettled(stem: string, taken: Pick<ReadonlySet<string>, "has">): string {
  for (let index = 0; ; index += 1) {
    if (!taken.has(`${stem}${letters(index)}`)) return `${stem}${letters(index)}`;
  }
}

/**
 * The ID a thread should have now. `taken` holds the IDs of the server's other threads.
 * Automatic assignment leaves placeholder titles and titles without an initial ID-free.
 */
export function reconcileThreadTitleId(input: {
  readonly current: string | null;
  readonly title: string;
  readonly settled: boolean;
  readonly taken: Pick<ReadonlySet<string>, "has">;
  readonly fallbackInitial?: string;
}): string | null {
  const initial =
    (input.title.trim() === "New thread" ? undefined : threadTitleInitial(input.title)) ??
    input.fallbackInitial;
  if (initial === undefined) return null;
  const { current, settled, taken } = input;
  const rest =
    current !== null && current.startsWith(initial)
      ? current.slice(initial.length).match(ID_REST)
      : null;
  // No ID yet, or the title now starts with another letter: a fresh one.
  if (current === null || rest === null) {
    return settled ? lowestFreeSettled(initial, taken) : lowestFreeActive(initial, taken);
  }
  const stem = `${initial}${rest[1]}`;
  const hasLetters = (rest[2] ?? "").length > 0;
  if (settled) {
    return hasLetters && !taken.has(current) ? current : lowestFreeSettled(stem, taken);
  }
  if (!hasLetters && !taken.has(current)) return current;
  return taken.has(stem) ? lowestFreeActive(initial, taken) : stem;
}
