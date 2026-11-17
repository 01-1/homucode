#!/usr/bin/env bash
set -euo pipefail
build_root=${1:-/home/user/t3-preview}
mkdir -p "$build_root"
cd "$build_root"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jdk-headless unzip zip >/dev/null
if [[ ${ANDROID_SETUP_ONLY:-0} != 1 ]]; then
  curl --retry 3 -fsSL https://nodejs.org/dist/v26.13.1/node-v26.13.1-linux-x64.tar.xz | tar -xJ
  export PATH=$build_root/node-v26.13.1-linux-x64/bin:$PATH
  npm install --global --prefix $build_root/tools corepack@latest
  export PATH=$build_root/tools/bin:$PATH
  corepack enable --install-directory $build_root/tools/bin
fi
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME="$build_root/android-sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"
curl --retry 3 -fsSL https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o commandlinetools.zip
unzip -oq commandlinetools.zip -d "$ANDROID_HOME/cmdline-tools"
rm -rf "$ANDROID_HOME/cmdline-tools/latest"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
set +o pipefail
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null
set -o pipefail
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
rm commandlinetools.zip
touch toolchain-ready
