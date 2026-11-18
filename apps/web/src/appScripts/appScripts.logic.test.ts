import { APP_SCRIPT_TYPE_DEFINITIONS, MAX_APP_SCRIPT_OUTPUT_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { T3App } from "./appScriptApi";
import { appScriptNameFromCommand, appScriptOutput, isLocalAppWindow } from "./appScripts.logic";

// Every member of the API the window builds; the type below fails to compile if one is missing.
const T3_APP_MEMBERS = [
  "command",
  "current",
  "projects",
  "threads",
  "openThread",
  "newThread",
  "send",
  "toast",
] as const satisfies ReadonlyArray<keyof T3App>;
const everyMemberListed: [Exclude<keyof T3App, (typeof T3_APP_MEMBERS)[number]>] extends [never]
  ? true
  : false = true;

describe("app scripts", () => {
  it("declares every API member in the shipped t3.d.ts", () => {
    expect(everyMemberListed).toBe(true);
    for (const member of T3_APP_MEMBERS) {
      expect(APP_SCRIPT_TYPE_DEFINITIONS).toContain(`  ${member}(`);
    }
  });

  it("reads the script name from user.<name>.run only", () => {
    expect(appScriptNameFromCommand("user.open-inbox.run")).toBe("open-inbox");
    expect(appScriptNameFromCommand("script.open-inbox.run")).toBeNull();
    expect(appScriptNameFromCommand("user.../x.run")).toBeNull();
  });

  it.each([
    [false, "localhost", true],
    [false, "127.0.0.1", true],
    [false, "[::1]", true],
    [false, "workstation.tail1234.ts.net", false],
    [false, "192.168.1.20", false],
    [false, "app.t3.codes", false],
    [true, "", true],
  ])("electron=%s host=%s runs scripts: %s", (electron, hostname, local) => {
    expect(isLocalAppWindow({ electron, hostname })).toBe(local);
  });

  it("returns JSON output, nothing for undefined, and cuts long output", () => {
    expect(appScriptOutput(undefined)).toBeNull();
    expect(appScriptOutput({ a: 1 })).toBe('{"a":1}');
    expect(appScriptOutput("x".repeat(MAX_APP_SCRIPT_OUTPUT_LENGTH + 10))?.length).toBe(
      MAX_APP_SCRIPT_OUTPUT_LENGTH + 1,
    );
  });
});
