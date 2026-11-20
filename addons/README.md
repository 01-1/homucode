# Add-ons

Optional build tools that ship with this repo and stay off until you set them up. Both are
available in the app. Enable **Show Building T3 settings** in **Settings → HomuCode → Building Homu**, then
configure each tool there. On mobile, open **Building T3** from that section. The tools run the
scripts from a configured checkout.

The scripts are Python 3 standard library. Each folder is self-contained and has its own README
with the details.

## Folders

**`cloud-build/`** builds or tests one committed T3 Code revision on a disposable
[boat.dev](https://boat.dev) box, brings back the AppImage (checked against `SHA256SUMS`) or the
test logs, and deletes the box.

**`load-build/`** has `t3-load-build`, which loads a staged T3 Code build: it verifies the file
and checksum, restarts T3 on it, and wakes an agent thread. If T3 fails to start or
waking the thread fails twice, it rolls back. The command-line tool can use a
`~/.local/bin/t3code` launcher that starts the newest AppImage in the build folder.

## In-app builds

Building T3 also runs `scripts/homu-android/build.sh` for a committed ref (default `origin/main`).
For refs that support EAS updates, configure the EAS owner and project ID on the T3 server
as described in [Android builds](../AGENTS.md#android-builds).
It shows the APK path and can serve the APK folder on the LAN, with an explicit off switch;
the HTTP server stops with T3. Cloud and Android builds need a signed-in boat CLI on the server.
Loading builds is available only on AppImage installs and restarts T3, with checksum verification
and automatic rollback. On desktop, **Settings → HomuCode → Building Homu** shows the staged build and keeps Undo and Redo available while
the build tools are hidden. All tools start disabled.

## Install

For command-line use, run the scripts from their folders under `addons/`. See the
[cloud builder](./cloud-build/README.md) and [build loader](./load-build/README.md) guides
for commands and requirements.
