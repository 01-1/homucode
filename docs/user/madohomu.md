# MadoHomu

Enable MadoHomu in Settings → General → MadoHomu, then choose the project it focuses on. If you have several connected environments, select the environment in Settings first. Open MadoHomu from the sidebar or the “Open MadoHomu” command palette action.

On mobile, use Settings → MadoHomu to enable it, choose its project and configure the morning brief. Open MadoHomu from the home thread list. Chat and Tasks open your normal mobile chat and composer; use Back to return to MadoHomu.

Chat uses your normal threads and composer. New MadoHomu threads start pinned in MadoHomu on all your devices. This is independent of sidebar pins. Unpinned threads and other threads in the project are labelled Temporary. Edit a thread to change its title, icon, icon color, short prompt, or pin state. Icons can come from Lucide or be custom emojis. The agent receives the current title, icon and prompt privately on each turn. Tasks puts threads awaiting approval or input first, followed by running work and recent threads.

The optional morning brief runs daily at the time you choose, in the server's time zone. It continues the pinned Morning brief thread, summarises work and decisions, and proposes next steps in plan mode. Like any thread, MadoHomu threads (including the brief) use the permission mode picked in their composer, and new ones start in the project's default permission mode. Turning the brief off disables its scheduled task; turning it back on reuses the task. Changing the MadoHomu project or disabling MadoHomu disables the brief too.

In the desktop app, enable MadoHomu's desktop app toggle to add its launcher. `--madohomu` opens a separate MadoHomu window. Split moves MadoHomu into its own window; Merge brings it back into the main window. Both use the same server and thread history. Disabling MadoHomu removes its launcher.

## Install the MadoHomu launcher

[MadoHomu](https://github.com/01-1/madohomu) can also be installed as a standalone launcher. Its implementation and installer live in HomuCode. Installing it adds only the MadoHomu launcher, with HomuCode as its runtime dependency. It shares T3 Code's server, settings and threads.

On Linux with Node.js 22 or newer:

```bash
curl -fsSL https://raw.githubusercontent.com/01-1/homucode/main/scripts/install-madohomu.mjs | node --input-type=module
```

The installer uses the latest HomuCode AppImage release. Until a release is available, use an AppImage built from the MadoHomu branch:

```bash
MADOHOMU_RUNTIME=/absolute/path/to/HomuCode.AppImage node scripts/install-madohomu.mjs
```

On Windows and macOS, use the desktop app toggle in MadoHomu settings with your HomuCode desktop build.

To remove the Linux launcher and its downloaded runtime, run `node scripts/install-madohomu.mjs --uninstall`. Your shared threads and settings stay available in T3 Code.
