# Appearance and themes

On web and desktop, open **Settings → Appearance** to choose a theme and follow the system
appearance or stay in light or dark mode. To use different themes for light and dark mode, select
the corresponding preview within each theme. Appearance preferences follow
[Settings sync](./project-settings.md#settings-sync).

To keep shared preferences the same across web, desktop and phone, opt into
**Settings → HomuCode → Settings sync** on each device. If two devices change the
same preference, choose which value to keep in the sync dialog. Device-specific
choices, including the sync switch and Faster phone launch, stay on that device.

On web and desktop, use **Change theme** in the command palette to select a theme without leaving chat.
Press **Cmd+Option+A** on macOS or **Ctrl+Alt+A** on Windows/Linux to open the theme picker directly.
Use **Change appearance** in the command palette to choose System, Light, or Dark independently of
the theme. **Cmd+Option+Shift+A** on macOS or **Ctrl+Alt+Shift+A** on Windows/Linux cycles through
those modes. Customize these shortcuts under **Settings → Keybindings**.

On mobile, open **Settings → Appearance**. Alongside built-in themes, mobile offers published
themes from your first enabled saved environment. It applies their colors only, without CSS.
Text, code, and terminal preferences remain specific to the device.

On Android 12 or newer, choose the **Material You** theme in Appearance to use colors from
your wallpaper. Selecting another theme replaces those colors. Like other themes, Material You
can be selected separately for light and dark appearances.
Android uses **Material You Layout** by default unless you have turned it off in Appearance.
It changes shapes, spacing, and controls independently
of the selected theme.

## Composer context

Git-backed projects show branch and worktree controls below the composer while you create a thread.
The controls retreat as the composer docks after you send the first message.

Turn on **Composer context** to keep those controls visible after the thread starts. This preference
applies to the web and desktop clients.

## Math

Turn on **Render math** in **Settings → Appearance** to typeset LaTeX in messages and Markdown
previews on web, desktop, and mobile. It reads `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`, outside of code.
Fenced `math` blocks also render. Formulas work in tables, including absolute-value bars.
Dollar amounts such as `$5 and $10` stay text; write `\$` to keep any other dollar sign literal.
Wide formulas scroll horizontally while the surrounding text wraps. Copying a formula or
exporting a table preserves the TeX.

The composer keeps TeX source editable, including when rich text is enabled. The Render math
preference also follows Settings sync, including on mobile.

## Motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Move the
**Panel animations** slider above 0 ms to add motion, up to 400 ms, unless reduced motion is enabled
in your operating system. Moving between threads always snaps to the selected thread's panel state
without replaying its transitions.

## Custom themes

On web and desktop, choose **Create theme** to adjust a palette, or import a T3 Code or VS Code
theme. The theme editor's color picker lets you select an area of the app to find the color to
change. Export your theme as JSON to share it.

### Custom CSS

For a change that colors cannot make, open **Custom CSS** in the theme editor. The CSS is saved with
the theme, applies after T3 Code's own styles on web and desktop, and is included in exports. Use
`.dark` or `:root:not(.dark)` to target one appearance.

Custom CSS cannot load files. `@import`, `image-set()`, and `url()` are ignored, except `url()`
with a `data:` address or an `#id`. This keeps an imported theme from sending what is on your screen
to another site.

Class names in the app change between releases. For rules that keep working, target `data-slot`
and other `data-` attributes, such as `[data-chat-header]` or `[data-slot="button"]`.

If a rule hides something you need, run `t3 theme set t3-chat` on the server to switch to a
built-in theme, or press **Cmd+Option+A** on macOS or **Ctrl+Alt+A** on Windows/Linux to pick
another theme.

### Ask an agent

An agent on the same machine as the server can restyle T3 Code for you. Ask it to change the look,
for example "make T3 Code's chat header taller" or "give T3 Code a solarized theme". It publishes
an [environment theme](#environment-themes) with colors and CSS, and web and desktop clients of that
server switch to it. It can also switch them to light, dark, or system mode. Below Full access,
T3 Code asks for your approval before changing the theme. When you ask for a small change, such
as darker message bubbles, it builds on the
theme you are using, so everything else stays as it was. To undo, ask it to set the theme you had
before. HomuTheme is the default.

## Environment themes

Environment themes and defaults come from the server serving your web app or the desktop app's
main local environment. With the desktop app's local environment off, they come from the
[background service](./background-service.md) on the same machine while the app is connected to
it. app.t3.codes and other connections do not use them.

On mobile, published themes and defaults come from the first enabled saved environment, even
when you view a thread on another machine. The picker names the source machine. While a selected
theme is unavailable, mobile uses its default colors and remembers your selection for when the
theme becomes available again.

Select a published theme in **Settings → Appearance** to follow its palette as the server updates
it. On web and desktop, **Duplicate** makes an independent copy you can edit, and a saved custom
theme with the same ID takes precedence. If the server stops publishing the selected theme,
T3 Code falls back to its standard theme.

Run this on the server to set a default and switch connected clients to it:

```bash
t3 theme set nightfall
```

Clients that are offline apply it when they reconnect. Each client applies the setting once;
choosing another theme afterward sticks until the next `t3 theme set`. Run the command again to
reapply it, even if the name is unchanged.

`t3 theme clear` removes the default without changing anyone's current theme. `t3 theme show` lists
the default and published themes.

### Publish a theme

Save a theme exported from T3 Code into `~/.t3/userdata/themes/` on the server, or the `themes`
directory under your custom state directory. The filename supplies the theme ID: `nightfall.json`
can be selected with `t3 theme set nightfall`. Keep the filename stable when updating its colors.
Do not use `system`, `light`, `dark`, or a built-in theme's ID.

For an integration that generates a palette, this shorter format also works:

```json
{
  "name": "Nightfall",
  "appearance": "dark",
  "canvas": "#1a1b26",
  "accent": "#7aa2f7",
  "colors": {
    "terminalSelection": "#292e42",
    "error": "#f7768e"
  }
}
```

Set `appearance` to `light` or `dark` and supply hex colors for `canvas` and `accent`. T3 Code
generates the rest. The optional `colors` overrides use the names in the theme editor's advanced
view. An optional `css` string adds [custom CSS](#custom-css).

To change only a few colors of a built-in or published theme, put just those in a file and
publish it on top of that theme:

```bash
t3 theme set lavender-darker.json --base lavender
```

The published theme keeps the base theme's other colors and its CSS, and the file's own `css`
comes after the base's. `colors` describes the file's `appearance`, so a file with
`"appearance": "dark"` changes the dark side of a light theme such as HomuTheme (id `lavender`).

Write updates to a temporary file and rename it into place so clients never read a partial theme.
Invalid files are not published.
