/** Keep provider instructions inside the agent-only timestamp added by orchestration. */
export function preserveMessageTimestamp(text: string, format: (text: string) => string): string {
  const prefix = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}: /.exec(text)?.[0];
  return prefix === undefined ? format(text) : `${prefix}${format(text.slice(prefix.length))}`;
}
