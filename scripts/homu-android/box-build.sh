#!/usr/bin/env bash
# Runs on the boat box: builds and signs one HomuCode Android APK, or with MODE=ota publishes
# the same commit's JS as an EAS update. Both share every step that feeds the native fingerprint.
# Usage: box-build.sh COMMIT VARIANT APP_NAME [apk|ota]
set -euo pipefail
build_root=/home/user/t3-preview
revision=${1:?full commit required}; variant=${2:?variant required}; app_name=${3:?app name required}; mode=${4:-apk}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
export PATH="$build_root/node-v26.13.1-linux-x64/bin:$build_root/tools/bin:$PATH"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME="$build_root/android-sdk" ANDROID_SDK_ROOT="$build_root/android-sdk"
export CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_GIT_STATUS=1 EXPO_NO_TYPESCRIPT_SETUP=1 NODE_OPTIONS=--max-old-space-size=6144
mkdir -p "$build_root/src" "$build_root/artifacts"
cd "$build_root/src"
tar -xzf "$build_root/source-$revision.tar.gz"
{ cat "$build_root/public.env"; echo "APP_VARIANT=$variant"; } > .env
python3 - "$app_name" <<'PY'
import pathlib,re,sys
p=pathlib.Path('apps/mobile/app.config.ts')
s,n=re.subn(r'appName: "T3 Code[^"]*"', 'appName: '+repr(sys.argv[1]).replace("'",'"'), p.read_text())
assert n==3, n
p.write_text(s)
PY
pnpm install --frozen-lockfile --filter=@t3tools/mobile...
cd apps/mobile
pnpm exec expo prebuild --clean --platform android --no-install
python3 - "$(date -u +%y%m%d%H)" <<'PY'
import pathlib,re,sys
p=pathlib.Path('android/app/build.gradle')
s,n=re.subn(r'versionCode \d+','versionCode '+sys.argv[1],p.read_text()); assert n==1
s=s.replace('react {','react {\n    extraPackagerArgs = ["--max-workers", "2"]',1)
p.write_text(s)
PY
pnpm exec expo config --type public --json > "$build_root/artifacts/config.json"
pnpm exec expo-updates runtimeversion:resolve --platform android > "$build_root/artifacts/runtime-version.json"
if [[ $mode == ota ]]; then
  EXPO_TOKEN=$(cat "$build_root/signing/expo-token") EAS_NO_VCS=1 pnpm dlx eas-cli@27.10.0 update \
    --platform android --channel "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["updates"]["requestHeaders"]["expo-channel-name"])' "$build_root/artifacts/config.json")" \
    --message "$revision" --non-interactive --json > "$build_root/artifacts/update.json"
  echo "PUBLISHED $revision $variant"; exit 0
fi
cd android
./gradlew :app:assembleRelease --no-daemon --max-workers=4 -PreactNativeArchitectures=arm64-v8a,x86_64
tools=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
apk="$build_root/artifacts/app.apk"
"$tools/apksigner" sign --ks "$build_root/signing/t3-preview.p12" --ks-key-alias t3-preview --ks-pass "file:$build_root/signing/store-password" --out "$apk" app/build/outputs/apk/release/app-release.apk
"$tools/apksigner" verify --print-certs "$apk" > "$apk.signing.txt"
"$tools/zipalign" -c -P 16 4 "$apk"
"$tools/aapt2" dump badging "$apk" > "$apk.badging.txt"
unzip -l "$apk" assets/index.android.bundle > /dev/null  # fails if the JS bundle is missing
(cd "$build_root/artifacts" && sha256sum app.apk > app.apk.sha256)
echo "BUILT $revision $variant"
