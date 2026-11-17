#!/usr/bin/env bash
set -euo pipefail

[[ $(hostname -s) == pbox ]] || { echo "This installer is for pbox." >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
lib="$HOME/.local/lib/homucode-checks"
bin="$HOME/.local/bin/vp"
if [[ -e $bin || -L $bin ]] && [[ $(readlink "$bin") != "$lib/vp" ]]; then
  echo "Existing Vite+ command at $bin. Move it onto PATH outside ~/.local/bin before installing." >&2
  exit 1
fi
printf 'Installing the HomuCode Vite+ wrapper on pbox at %s and %s\n' "$bin" "$lib"
mkdir -p "$lib" "$(dirname "$bin")"
version=$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' "$here/../../pnpm-workspace.yaml")
mkdir -p "$lib/vite-plus"
if [[ ! -x "$lib/vite-plus/node_modules/.bin/vp" ]] ||
  [[ $(node -p "require(process.argv[1]).version" "$lib/vite-plus/node_modules/vite-plus/package.json") != "$version" ]]; then
  cd "$lib/vite-plus"
  [[ -f package.json ]] || printf '%s\n' '{"private":true}' > package.json
  pnpm add --save-exact "vite-plus@$version"
fi
install -m 755 "$here/vp" "$here/cloud.py" "$lib/"
install -m 644 "$here/remote.sh" "$lib/"
ln -sfn "$lib/vp" "$bin"
