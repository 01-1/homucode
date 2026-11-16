import * as Schema from "effect/Schema";

/** Claude Code's status line input: https://code.claude.com/docs/en/statusline */
export const StatusLineRenderInput = Schema.Struct({
  input: Schema.Record(Schema.String, Schema.Unknown),
});
export type StatusLineRenderInput = typeof StatusLineRenderInput.Type;

export const StatusLineRenderResult = Schema.Struct({
  /** The command's first line of stdout, ANSI escapes included. Empty when it printed nothing. */
  text: Schema.String,
  error: Schema.optionalKey(Schema.String),
});
export type StatusLineRenderResult = typeof StatusLineRenderResult.Type;
