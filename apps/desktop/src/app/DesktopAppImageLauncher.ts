import { renderAppImageRuntime, shellWord } from "./DesktopAppImageRuntime.ts";

export const APPIMAGE_LAUNCHER_MARKER =
  "Written by T3 Code: launches the desktop from its pinned AppImage cache.";

export const renderAppImageLauncher = (input: {
  readonly appImage: string;
  readonly executableName: string;
  readonly t3Home: string;
}): string =>
  [
    "#!/bin/sh",
    `# ${APPIMAGE_LAUNCHER_MARKER}`,
    `app=${shellWord(input.appImage)}`,
    `home=${shellWord(input.t3Home)}`,
    'export T3CODE_HOME="${T3CODE_HOME:-$home}"',
    "unset ELECTRON_RUN_AS_NODE",
    "if runtime=$(",
    ...renderAppImageRuntime(input.executableName).map((line) => `  ${line}`),
    '  printf "%s" "$runtime"',
    "); then",
    '  export APPIMAGE="$app" APPDIR="$runtime"',
    `  exec "$runtime/${input.executableName}" "$@"`,
    "fi",
    'exec "$app" "$@"',
    "",
  ].join("\n");
