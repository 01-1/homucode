// Thread title IDs are short handles shown before a title, stored in the thread's `titleId`.
// Active threads get the title's first letter, then a base-10 number when another thread has it:
// "F", "F1", "F2". Settling adds letters ("F1" -> "F1a") so the number is free for active threads
// again; unsettling drops them, or takes the next free number if an active thread took it meanwhile.

const FIRST_CHARACTER = /[\p{L}\p{N}]/u;
const SETTLED_SUFFIX = /[a-z]+$/;
const NUMBER_SUFFIX = /\d+$/;

/** The title's first letter or digit, upper-cased; undefined when it has none. */
export function threadTitleInitial(title: string): string | undefined {
  return title.match(FIRST_CHARACTER)?.[0]?.toLocaleUpperCase();
}

function splitSettledSuffix(id: string): { stem: string; letters: string } {
  const letters = id.match(SETTLED_SUFFIX)?.[0] ?? "";
  // A lower-case initial with no upper-case form is part of the stem, not a suffix.
  return letters.length === id.length
    ? { stem: id, letters: "" }
    : { stem: id.slice(0, id.length - letters.length), letters };
}

function initialOfStem(stem: string): string {
  return stem.replace(NUMBER_SUFFIX, "") || stem;
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

/** The active ID for `initial`: bare if free, otherwise the lowest free number from 1. */
function nextActiveThreadTitleId(initial: string, taken: ReadonlySet<string>): string {
  if (!taken.has(initial)) return initial;
  for (let number = 1; ; number += 1) {
    if (!taken.has(`${initial}${number}`)) return `${initial}${number}`;
  }
}

function nextSettledThreadTitleId(stem: string, taken: ReadonlySet<string>): string {
  for (let index = 0; ; index += 1) {
    if (!taken.has(`${stem}${letters(index)}`)) return `${stem}${letters(index)}`;
  }
}

/** Whether `id` still fits a thread whose title starts with `initial`. */
export function threadTitleIdMatchesInitial(id: string, initial: string): boolean {
  return initialOfStem(splitSettledSuffix(id).stem) === initial;
}

/** A fresh ID for a thread in the given state. */
export function assignThreadTitleId(input: {
  readonly initial: string;
  readonly settled: boolean;
  readonly taken: ReadonlySet<string>;
}): string {
  return input.settled
    ? nextSettledThreadTitleId(input.initial, input.taken)
    : nextActiveThreadTitleId(input.initial, input.taken);
}

/** The ID a thread should have after settling or unsettling; returns `id` when it already fits. */
export function syncThreadTitleId(input: {
  readonly id: string;
  readonly settled: boolean;
  readonly taken: ReadonlySet<string>;
}): string {
  const { stem, letters: suffix } = splitSettledSuffix(input.id);
  if (input.settled) {
    return suffix.length > 0 && !input.taken.has(input.id)
      ? input.id
      : nextSettledThreadTitleId(stem, input.taken);
  }
  if (suffix.length === 0 && !input.taken.has(input.id)) return input.id;
  return input.taken.has(stem) ? nextActiveThreadTitleId(initialOfStem(stem), input.taken) : stem;
}
