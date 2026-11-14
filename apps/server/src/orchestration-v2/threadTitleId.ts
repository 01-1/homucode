// Thread title IDs: the first letter of each of the title's first three words, plus a
// base-36 counter (0, 1, ... 9, a, ...) when another thread in the project already uses it.
// They live in the title itself, as its first word: "FLB Fix login bug", "FLB0 Find lost backups".

const ID_TOKEN = /^(?:[\p{Lu}\p{Nd}]|[\p{Lu}\p{Nd}]{2,3}[0-9a-z]*)$/u;
const WORD_START = /[\p{L}\p{N}]/u;

/** The initials of the title's first three words that contain a letter or digit. */
export function threadTitleInitials(title: string): string {
  return title
    .split(/\s+/)
    .map((word) => word.match(WORD_START)?.[0])
    .filter((char): char is string => char !== undefined)
    .slice(0, 3)
    .map((char) => char.toLocaleUpperCase())
    .join("");
}

/** Splits a leading ID word off a title. Titles without one come back with `id: undefined`. */
export function splitThreadTitleId(title: string): { id: string | undefined; rest: string } {
  const trimmed = title.trim();
  const space = trimmed.indexOf(" ");
  if (space <= 0) return { id: undefined, rest: trimmed };
  const token = trimmed.slice(0, space);
  const rest = trimmed.slice(space + 1).trim();
  return ID_TOKEN.test(token) && rest.length > 0
    ? { id: token, rest }
    : { id: undefined, rest: trimmed };
}

/** The ID for `title`: its initials, or the initials plus the lowest free base-36 counter. */
export function assignThreadTitleId(
  title: string,
  otherTitles: Iterable<string>,
): string | undefined {
  const base = threadTitleInitials(title);
  if (base.length === 0) return undefined;
  const taken = new Set<string>();
  for (const other of otherTitles) {
    const { id } = splitThreadTitleId(other);
    if (id !== undefined) taken.add(id);
  }
  if (!taken.has(base)) return base;
  for (let counter = 0; ; counter += 1) {
    const candidate = `${base}${counter.toString(36)}`;
    if (!taken.has(candidate)) return candidate;
  }
}
