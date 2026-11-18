# MadoHomu

On web and desktop, choose a project in Settings → General → MadoHomu. Projects are listed with their machines. Choosing one enables MadoHomu on that machine and makes it the destination for future launches. Open MadoHomu from the sidebar or the “Open MadoHomu” command palette action.

On mobile, use Settings → MadoHomu to enable it, choose its project and configure the morning brief. Open MadoHomu from the home thread list, or on Android wide layouts such as an unfolded phone, from MadoHomu in the navigation rail. Threads open in your normal mobile chat and composer; use Back to return to MadoHomu.

MadoHomu is one thread list in sections, and threads use your normal chat and composer.

- **Pinned** holds the threads you make in MadoHomu, on all your devices. This is independent of sidebar pins. Drag to reorder them. On mobile, choose Reorder in the gear menu or a thread's menu first, or use Move up and Move down in the thread menu.
- **Your own sections** sit below Pinned. Add one with New section in the gear menu, the + on the Pinned heading (web and desktop), or Move to → New section in a thread's menu. A thread moved into a section goes to its end. Deleting a section returns its threads to Pinned.
- **Scratch** holds every other thread in the project, such as ones made in T3 Code or by agents, and any you move there, newest first by when you last wrote in each, as in the T3 Code list. It shows its first 10 threads and a Show more row; a thread that needs your approval or an answer always shows. Drag a thread onto Pinned or a section to pin it, or use Move to in its menu.
- **Working** shows Scratch threads while they are working and nothing waits on you. "Working threads" in MadoHomu settings can put them at the top of Scratch or leave them in place instead. Pinned threads never move.
- **Snoozed** and **Settled** hold threads from any section while they are snoozed or settled, newest first by when you last wrote in each.

Every section folds from its heading. A folded section that holds threads waiting on you (an approval, a question or a guest's request) shows how many.

On web and desktop, the thread keyboard shortcuts move through MadoHomu's rows, and links to threads in the project open inside MadoHomu.

The thread menu (right-click or the row's … button, or long-press on mobile) has everything the normal thread list has, plus Edit, which changes a thread's title, icon, icon color and short prompt, and Move to. On mobile, the open thread's header menu has Move to and Edit too. New thread on a branch, started from a MadoHomu thread, files the new thread in Pinned. Inside MadoHomu, T3 Code's own pin and folders are labelled "Pin in T3 Code" and "Move to T3 Code folder". Icons can come from Lucide or be custom emojis. The agent receives the current title, icon and prompt privately on each turn.

MadoHomu's threads are hidden from the T3 Code thread list. To see them there too, set "Show MadoHomu threads in T3 Code" in MadoHomu settings to Scratch only or All. Search and links still open hidden threads.

To change MadoHomu's project, use Change project in the gear menu or MadoHomu settings. "New project" makes one without leaving MadoHomu. Clear project is in MadoHomu settings only.

The optional morning brief runs daily at the time you choose, in the server's time zone. It continues the pinned Morning brief thread, summarises work and decisions, and proposes next steps in plan mode. Like any thread, MadoHomu threads (including the brief) use the permission mode picked in their composer, and new ones start in the project's default permission mode. Turning the brief off disables its scheduled task; turning it back on reuses the task. Changing the MadoHomu project or disabling MadoHomu disables the brief too.

In the desktop app, enable MadoHomu's desktop app toggle to add its launcher. `--madohomu` opens a separate, landscape MadoHomu window. Split moves MadoHomu into its own window; Merge brings it back into the main window. Both use the same server and thread history. Disabling MadoHomu removes its launcher.

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
