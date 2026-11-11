import * as Context from "effect/Context";

export class BackgroundGitEnabled extends Context.Reference<boolean>(
  "t3/vcs/BackgroundGitEnabled",
  { defaultValue: () => process.env.T3CODE_BACKGROUND_GIT !== "0" },
) {}
