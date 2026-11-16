#!/usr/bin/env bash
set -euo pipefail
cd /home/user/t3-preview
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jdk-headless unzip zip >/dev/null
curl --retry 3 -fsSL https://nodejs.org/dist/v26.13.1/node-v26.13.1-linux-x64.tar.xz | tar -xJ
export PATH=/home/user/t3-preview/node-v26.13.1-linux-x64/bin:$PATH
npm install --global --prefix /home/user/t3-preview/tools corepack@latest
export PATH=/home/user/t3-preview/tools/bin:$PATH
corepack enable --install-directory /home/user/t3-preview/tools/bin
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=/home/user/t3-preview/android-sdk
mkdir -p "$ANDROID_HOME/cmdline-tools"
curl --retry 3 -fsSL https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o commandlinetools.zip
unzip -q commandlinetools.zip -d "$ANDROID_HOME/cmdline-tools"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
set +o pipefail
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null
set -o pipefail
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
touch toolchain-ready
