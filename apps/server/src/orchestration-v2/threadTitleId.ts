// Thread title IDs are short handles shown before a title, stored in the thread's `titleId`.
// Active threads get the title's first letter, then a base-10 number when another thread has it:
// "F", "F1", "F2". Settling adds letters ("F1" -> "F1a") so the number is free for active threads
// again; unsettling goes back to the thread's own number when it is free, otherwise to the lowest
// free one. The initial always comes from the title, so a digit initial ("7", "71") stays unambiguous.

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

function lowestFreeActive(initial: string, taken: ReadonlySet<string>): string {
  if (!taken.has(initial)) return initial;
  for (let number = 1; ; number += 1) {
    if (!taken.has(`${initial}${number}`)) return `${initial}${number}`;
  }
}

function lowestFreeSettled(stem: string, taken: ReadonlySet<string>): string {
  for (let index = 0; ; index += 1) {
    if (!taken.has(`${stem}${letters(index)}`)) return `${stem}${letters(index)}`;
  }
}

/**
 * The ID a thread should have now. `taken` holds the IDs of the project's other threads.
 * Returns null when the title gives no initial (or is still the "New thread" placeholder).
 */
export function reconcileThreadTitleId(input: {
  readonly current: string | null;
  readonly title: string;
  readonly settled: boolean;
  readonly taken: ReadonlySet<string>;
}): string | null {
  const initial = input.title.trim() === "New thread" ? undefined : threadTitleInitial(input.title);
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
