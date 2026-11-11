export const shellWord = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export const renderAppImageRuntime = (executableName: string): readonly string[] => [
  "unset APPIMAGE_EXTRACT_AND_RUN",
  "umask 077",
  'cache="${XDG_CACHE_HOME:-${HOME:-$home}/.cache}/t3code/cli-runtime"',
  'mkdir -p "$cache" && chmod 700 "$cache" || exit 1',
  'digest=$(sha256sum <"$app") || exit 1',
  "digest=${digest%% *}",
  'runtime="$cache/$digest"',
  // A shared lock also prevents another CLI from observing a partial extraction.
  'exec 9>"$cache/$digest.lock" || exit 1',
  "flock 9 || exit 1",
  `if [ ! -x "$runtime/${executableName}" ] || [ ! -f "$runtime/resources/app.asar" ]; then`,
  '  work=$(mktemp -d "$cache/.extract.XXXXXX") || exit 1',
  `  trap 'rm -rf "$work"' EXIT`,
  "  trap 'exit 130' INT TERM",
  '  (cd "$work" && "$app" --appimage-extract >/dev/null) || { echo "Could not open $app." >&2; exit 1; }',
  '  verified=$(sha256sum <"$app") || exit 1',
  '  [ "${verified%% *}" = "$digest" ] || { echo "T3 Code changed during extraction; retry the command." >&2; exit 1; }',
  `  [ -x "$work/squashfs-root/${executableName}" ] && [ -f "$work/squashfs-root/resources/app.asar" ] || exit 1`,
  '  mv -T "$work/squashfs-root" "$runtime" || exit 1',
  '  rm -rf "$work"',
  "  trap - EXIT INT TERM",
  "fi",
  "flock -u 9",
  "exec 9>&-",
];
