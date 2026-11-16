# Duet

Enable Duet in Settings → General → Duet, then choose the project it focuses on. If you have several connected environments, select the environment in Settings first. Open Duet from the sidebar or the “Open Duet” command palette action.

On mobile, use Settings → Duet to enable it, choose its project and configure the morning brief. Open Duet from the home thread list. Chat and Tasks open your normal mobile chat and composer; use Back to return to Duet.

Chat uses your normal threads and composer. New Duet threads start pinned in Duet on all your devices. This is independent of sidebar pins. Unpinned threads and other threads in the project are labelled Temporary. Edit a thread to change its title, icon, icon color, short prompt, or pin state. Icons can come from Lucide or be custom emojis. The agent receives the current title, icon and prompt privately on each turn. Tasks puts threads awaiting approval or input first, followed by running work and recent threads.

The optional morning brief runs daily at the time you choose, in the server's time zone. It continues the pinned Morning brief thread, summarises work and decisions, and proposes next steps in plan mode with approval required. Turning the brief off disables its scheduled task; turning it back on reuses the task. Changing the Duet project or disabling Duet disables the brief too.

In the desktop app, enable Duet's desktop app toggle to add its launcher. `--duet` opens a separate Duet window. Split moves Duet into its own window; Merge brings it back into the main window. Both use the same server and thread history. Disabling Duet removes its launcher.

## Install MadoHomu

[MadoHomu](https://github.com/01-1/madohomu) is a thin launcher for Duet. Its implementation and installer live in Homu Code. Installing it adds only the MadoHomu launcher, with Homu Code as its runtime dependency. It shares T3 Code's server, settings and threads.

On Linux with Node.js 22 or newer:

```bash
curl -fsSL https://raw.githubusercontent.com/01-1/homucode/main/scripts/install-madohomu.mjs | node --input-type=module
```

The installer uses the latest Homu Code AppImage release. Until a release is available, use an AppImage built from the Duet branch:

```bash
MADOHOMU_RUNTIME=/absolute/path/to/Homu-Code.AppImage node scripts/install-madohomu.mjs
```

On Windows and macOS, use the desktop app toggle in Duet settings with your Homu Code desktop build.

To remove the Linux launcher and its downloaded runtime, run `node scripts/install-madohomu.mjs --uninstall`. Your shared threads and settings stay available in T3 Code.
