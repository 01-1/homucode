#!/usr/bin/env bash
set -euo pipefail

box="$HOME/homucode-checks"
source_dir="$box/source"
request="$box/request"
if [[ $1 != locked ]]; then
  exec flock --close "$box/worktree.lock" bash "$0" locked "$@"
fi
shift
mode=$1
shift
mkdir -p "$source_dir"
cd "$source_dir"

if [[ $mode == init ]]; then
  git init -q
  if ! git show-ref --verify --quiet refs/remotes/origin/main; then
    git fetch --no-tags https://github.com/homura-ai/homucode.git main:refs/remotes/origin/main
  fi
  while (($#)); do
    git config "remote.$1.url" "$2"
    shift 2
  done
  exit
fi

git clean -ffdq
git checkout -fq --detach refs/heads/boat-check
git clean -ffdq
if [[ -s "$request/staged.patch" ]]; then
  git apply --index --binary "$request/staged.patch"
fi
if [[ -s "$request/unstaged.patch" ]]; then
  git apply --binary "$request/unstaged.patch"
fi
if [[ -d "$request/tree" ]]; then cp -a "$request/tree/." .; fi

tools="$box/tools"
mkdir -p "$tools"
if [[ ! -f "$tools/system-ready" ]]; then
  sudo -n apt-get update -qq
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential pkg-config libsecret-1-dev
  touch "$tools/system-ready"
fi
node_version=$(node -p 'require("./package.json").engines.node')
pnpm_version=$(node -p 'require("./package.json").packageManager.split("@")[1]')
node_dist="node-v$node_version-linux-x64"
if [[ ! -x "$tools/$node_dist/bin/node" ]]; then
  (
    cd "$tools"
    url="https://nodejs.org/dist/v$node_version"
    curl --retry 3 -fsSLO "$url/$node_dist.tar.xz"
    curl --retry 3 -fsSLO "$url/SHASUMS256.txt"
    awk -v file="$node_dist.tar.xz" '$2 == file' SHASUMS256.txt | sha256sum -c -
    tar -xf "$node_dist.tar.xz"
    rm "$node_dist.tar.xz" SHASUMS256.txt
  )
fi
export PATH="$tools/$node_dist/bin:$tools/pnpm-$pnpm_version/bin:$PATH"
if [[ ! -x "$tools/pnpm-$pnpm_version/bin/pnpm" ]]; then
  npm install --global --prefix "$tools/pnpm-$pnpm_version" "pnpm@$pnpm_version"
fi

CI=1 pnpm install --frozen-lockfile --reporter=append-only
export PATH="$source_dir/node_modules/.bin:$PATH"
export VP_REMOTE_CACHE=off

if [[ ${1:-} == android ]]; then
  shift
  export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  export ANDROID_HOME="$box/android/android-sdk" ANDROID_SDK_ROOT="$box/android/android-sdk"
  if [[ ! -f "$box/android/toolchain-ready" ]]; then
    ANDROID_SETUP_ONLY=1 bash scripts/homu-android/box-setup.sh "$box/android"
  fi
  export GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.workers.max=2"
  export T3_NATIVE_CLIENT_CACHE=off T3_NATIVE_CLIENT_VERBOSE=1
  exec node scripts/mobile-native-client.ts ensure android --prepare --abi "$1" --expect-fingerprint "$2"
fi

case "${1:-} ${2:-}" in
  "test "*|"exec vitest"|"run test"*|"run check:changed")
    playwright=apps/web/node_modules/playwright/cli.js
    if [[ ! -f "$tools/browser-deps-ready" ]]; then
      node "$playwright" install-deps chromium
      touch "$tools/browser-deps-ready"
    fi
    node "$playwright" install --only-shell chromium
    ;;
esac

cd "$mode"
vp "$@"
