# Upstream todo

HomuCode fixes that could go to upstream T3 Code (`pingdotgg/t3code`) but aren't ready to file yet. Filing rules: [upstream_contributing.md](upstream_contributing.md).

## AppImage thread links don't reuse the pinned cache

- Commits: `9a38686c5f` (reuse pinned AppImage cache for thread links), `3160c39480` (isolate runtime cache from install ownership), `68648f1486` (preserve cached URL handler before instance lock).
- Size: about 11 files, +254/−43, desktop Linux only.
- Before filing:
  - [ ] Check upstream main still has the bug.
  - [ ] File an issue first. The fix is too big to skip one under CONTRIBUTING.
  - [ ] Squash the three commits onto current upstream main.
  - [ ] Get evidence from a real AppImage install: a `t3code://` thread link reuses the pinned cache.

## Git config cache

- Commits: `c5fad306f5` plus fixes `aa18105ebd` and `1afb966da1`. The first version was reverted in `ccce8b6199` for breaking three tests.
- Upstream status and pull-request lookups run `git config` again and again. The cache keeps each read for one second and shares identical reads that are in flight.
- Related upstream: #36673 (closed, 39 Git processes per status refresh on Windows). PR #36870 fixed only the untracked-file scan.
- Before filing:
  - [ ] Run it in a built app.
  - [ ] Measure Git process counts per status refresh before and after.
  - [ ] File an issue with those numbers, then the PR.

## Features that need maintainer approval first

Ask in an Ideas discussion or on the issue before writing a PR.

- [ ] `--mode` for `t3 thread send` (`b0818dc7a9`). Issue [#30205](https://github.com/pingdotgg/t3code/issues/30205) was closed as a feature request; the maintainer directed it to Discussions.
- [ ] Continue conversations by default in schedules (`7a015c513a`).
- [ ] `T3CODE_BACKGROUND_GIT=0` switch (`4e9a0080b2`).

## On hold

- [ ] Wayland URL activation (branch `upstream/fix-wayland-url-activation`, `cad2352500`). Waiting for a maintainer reply on #33635 (our comment, 2026-11-16).
