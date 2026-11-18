import { describe, expect, it } from "vite-plus/test";

import { resolveCdCommand } from "./composerCdCommand";

const cd = (prompt: string, cwd: string | null = "/home/user/code/app") =>
  resolveCdCommand({ prompt, cwd });

describe("resolveCdCommand", () => {
  it.each([
    ["/cd /srv/site", "/srv/site"],
    ["/cd ~/notes", "~/notes"],
    ["/cd lib", "/home/user/code/app/lib"],
    ["/cd ./lib/", "/home/user/code/app/lib"],
    ["/cd ..", "/home/user/code"],
    ["/cd ../other", "/home/user/code/other"],
    ['/cd "/srv/my site"', "/srv/my site"],
  ])("resolves %j to %j", (prompt, path) => {
    expect(cd(prompt)).toEqual({ kind: "cd", path });
  });

  it("needs a folder, and a current folder for a relative one", () => {
    expect(cd("/cd")).toMatchObject({ kind: "blocked", title: "No folder" });
    expect(cd("/cd lib", null)).toMatchObject({ kind: "blocked", title: "No current folder" });
    expect(cd("/cd /srv", null)).toEqual({ kind: "cd", path: "/srv" });
  });

  it("ignores other messages", () => {
    expect(cd("/cdx")).toEqual({ kind: "none" });
    expect(cd("please /cd lib")).toEqual({ kind: "none" });
  });
});
