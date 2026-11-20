import * as AzureDevOpsDriver from "@t3tools/source-control-azure-devops/server/driver";
import * as BitbucketDriver from "@t3tools/source-control-bitbucket/server/driver";
import * as CursorOriginDriver from "@t3tools/source-control-cursor-origin/server/driver";
import { builtInSourceControlDefinitions } from "@t3tools/source-control-definitions/registry";
import * as ForgejoDriver from "@t3tools/source-control-forgejo/server/driver";
import * as GitCafeDriver from "@t3tools/source-control-gitcafe/server/driver";
import * as GitHubDriver from "@t3tools/source-control-github/server/driver";
import * as GitLabDriver from "@t3tools/source-control-gitlab/server/driver";

/** In the shared registry's order, which is the order hosts are listed and probed in. */
export const BUILT_IN_SOURCE_CONTROL_DRIVER_LIST = [
  GitHubDriver.driver,
  CursorOriginDriver.driver,
  GitLabDriver.driver,
  GitCafeDriver.driver,
  ForgejoDriver.driver,
  BitbucketDriver.driver,
  AzureDevOpsDriver.driver,
] as const;

export const sourceControlDefinitions = builtInSourceControlDefinitions;

/** A host CLI command that merges or closes a change request, such as `gh pr merge`. */
export const isChangeRequestCloseCommand = (command: string) =>
  sourceControlDefinitions.definitions.some(
    (definition) => definition.changeRequestCloseCommand?.test(command) === true,
  );

// A shell word may join quoted and unquoted parts, as in --body="-R".
const SHELL_TOKEN = /[;&|\n]|(?:\\[^\n]|"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?|[^\s"'\\;&|])+/gu;
const SHELL_QUOTING = /"((?:\\[\s\S]|[^"\\])*)"?|'([^']*)'?|\\([\s\S])/gu;
const SHELL_SEPARATOR = /^[;&|\n]$/u;
// A whole word that names one, so a number inside `--subject "Release 20"` does not.
const NAMED_CHANGE_REQUEST = /^(?:--?[\w-]+=)?#?(\d+)$|^\S*\/(?:pulls?|merge_requests)\/(\d+)\/?$/u;

const CLOSE_OPTION_VALUES = new Set([
  "--body",
  "-b",
  "--body-file",
  "-F",
  "--subject",
  "-t",
  "--match-head-commit",
  "--message",
  "--comment",
]);

/** The explicit and branch-based targets of merge or close commands in one shell invocation. */
export function changeRequestsClosedBy(command: string): {
  readonly named: ReadonlySet<number | string>;
  readonly implicit: boolean;
} {
  const named = new Set<number | string>();
  let implicit = false;
  for (const { changeRequestCloseCommand: close } of sourceControlDefinitions.definitions) {
    if (close === undefined) continue;
    for (const match of command.matchAll(new RegExp(close.source, `${close.flags}g`))) {
      // Start at the match: Azure's pattern runs through --id to --status.
      const args = command.slice(match.index);
      const words: string[] = [];
      for (const [raw] of args.matchAll(SHELL_TOKEN)) {
        if (SHELL_SEPARATOR.test(raw) || /^#(?!\d+$)/u.test(raw)) break;
        words.push(
          raw.replace(
            SHELL_QUOTING,
            (_, double, single, escaped) => double ?? single ?? escaped ?? "",
          ),
        );
      }
      let target: number | string | undefined;
      let repositorySpecified = false;
      let skipValue = false;
      for (const word of words) {
        if (skipValue) {
          skipValue = false;
          continue;
        }
        if (/^(?:-R|--repo)(?:=|$)/u.test(word)) {
          repositorySpecified = true;
          skipValue = !word.includes("=");
          continue;
        }
        if (CLOSE_OPTION_VALUES.has(word)) {
          skipValue = true;
          continue;
        }
        if (target !== undefined) continue;
        const [, number, url] = NAMED_CHANGE_REQUEST.exec(word) ?? [];
        if (number !== undefined || url !== undefined) {
          target = number === undefined ? word : Number(number);
        }
      }
      if (typeof target === "string" || (target !== undefined && !repositorySpecified)) {
        named.add(target);
      } else if (target === undefined && !repositorySpecified) {
        implicit = true;
      }
    }
  }
  return { named, implicit };
}
