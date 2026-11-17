# Add-ons

Optional build tools that ship with this repo and stay off until you set them up. Both are
available in the app: enable "Show Building T3 settings" in Settings → General, then enable and
configure each tool in Settings → Building T3. They run the scripts from a configured checkout.

The scripts are Python 3 standard library. Each folder is self-contained and has its own README
with the details.

## Folders

**`cloud-build/`** builds or tests one committed T3 Code revision on a disposable
[boat.dev](https://boat.dev) box, brings back the AppImage (checked against `SHA256SUMS`) or the
test logs, and deletes the box. Status: a real cold build has worked; the warm dependency-cache
path is covered only by unit tests. Tests: `cd cloud-build && python3 -m unittest -v test_boat_t3_build`.

**`load-build/`** has `t3-load-build`, which loads a staged T3 Code build: it verifies the file
and checksum, restarts T3 on it, wakes an agent thread, and rolls back to the previous build by
itself if T3 doesn't come up. It needs a `~/.local/bin/t3code` launcher that starts the newest
AppImage in the build folder (not part of T3 Code). Status: tested with fakes only. Tests:
`python3 -m unittest discover -s load-build -p 'test_*.py' -v`.

## In-app builds

Building T3 also runs `scripts/homu-android/build.sh` for a committed ref (default `origin/main`).
It shows the APK path and can serve the APK folder on the LAN, with an explicit off switch;
the HTTP server stops with T3. Cloud and Android builds need a signed-in boat CLI on the server.
Loading builds is available only on AppImage installs and restarts T3, with checksum verification
and automatic rollback. The page shows the running and staged builds and shares Undo/Redo with
Settings → About; About keeps the control while Building T3 is hidden. All tools start disabled.

## Install

There is no package. Either run the scripts from their folders under `addons/` or copy them into
place, as each folder's README shows (for example
`install -m 755 load-build/t3-load-build ~/.local/bin/`). All tests are offline: they use a fake
`boat`, temporary directories and fakes for T3, and never touch a running T3.
