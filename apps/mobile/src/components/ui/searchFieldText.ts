export interface SearchFieldTextState {
  readonly text: string;
  readonly pending: readonly string[];
}

// A value the field reported itself is an echo and leaves the typed text alone, even when
// it is older than what was typed since. Any other value came from outside and replaces it.
export function reconcileSearchFieldText(
  state: SearchFieldTextState,
  value: string,
): SearchFieldTextState {
  const echoed = state.pending.indexOf(value);
  return echoed === -1
    ? { text: value, pending: [] }
    : { text: state.text, pending: state.pending.slice(echoed + 1) };
}
