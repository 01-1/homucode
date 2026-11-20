#!/usr/bin/env bash
# Exercises build.sh and ota.sh without Boat, Android tooling, or EAS.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
repo="$temp/repo"
scripts="$repo/scripts/homu-android"
mkdir -p "$scripts" "$repo/apps/mobile" "$temp/signing"
cp "$here/"{build.sh,box-build.sh,box-setup.sh,link-widget-deps.cjs,verify-apk-updates.py,ota.sh,public.env} "$scripts"
git -C "$repo" init -q
git -C "$repo" -c user.name=fixture -c user.email=fixture@example.invalid commit -qm pre-EAS --allow-empty
git -C "$repo" tag pre-eas
echo T3CODE_EAS_PROJECT_ID > "$repo/apps/mobile/app.config.ts"
git -C "$repo" add apps/mobile/app.config.ts
git -C "$repo" -c user.name=fixture -c user.email=fixture@example.invalid commit -qm EAS
cat > "$temp/android.env" <<'ENV'
T3CODE_EAS_OWNER=fixture
T3CODE_EAS_PROJECT_ID=11111111-1111-1111-1111-111111111111
ENV
touch "$temp/signing/"{t3-preview.p12,store-password}
echo fixture > "$temp/token"

cat > "$temp/boat" <<'BOAT'
#!/usr/bin/env bash
set -euo pipefail
shift # --no-update
remote=/home/user/t3-preview
box=bx_fixture
case "$1" in
  new) echo '{"id":"bx_fixture"}';;
  delete) [[ $2 == "$box" ]]; echo delete >> "$trace";;
  scp)
    if [[ $2 == "$box:$remote/"* ]]; then
      cp "$sandbox/${2#"$box:$remote/"}" "$3"
    else
      [[ $3 == "$box:$remote/"* ]]
      cp "$2" "$sandbox/${3#"$box:$remote/"}"
      [[ $3 != */expo-token ]] || echo token >> "$trace"
    fi;;
  ssh)
    [[ $2 == "$box" && $3 == -- ]]
    case "$4" in
      *box-setup.sh) ;;
      *box-build.sh*" publish") bash -c "${4//"$remote"/"$sandbox"}";;
      *box-build.sh*)
        mode=${4##* }
        mkdir -p "$sandbox/artifacts" "$sandbox/src/apps/mobile" "$sandbox/tools/bin"
        echo T3CODE_MOBILE_RUNTIME_VERSION=fixture-runtime > "$sandbox/src/.env"
        echo '{"runtimeVersion":"fixture-runtime"}' > "$sandbox/artifacts/runtime-version.json"
        printf '{"updates":{"enabled":%s,"requestHeaders":{"expo-channel-name":"fixture-channel"}}}\n' \
          "${updates_enabled:-true}" > "$sandbox/artifacts/config.json"
        cp "$fixture_pnpm" "$sandbox/tools/bin/pnpm"
        if [[ $mode == apk ]]; then
          cd "$sandbox/artifacts"
          echo signed-apk > app.apk
          sha256sum app.apk > app.apk.sha256
          if [[ ${corrupt_apk:-0} == 1 ]]; then echo corrupted >> app.apk; fi
          touch app.apk.{badging,signing}.txt
        fi
        echo "$mode" >> "$trace";;
      *) bash -c "${4//"$remote"/"$sandbox"}";;
    esac;;
  *) exit 1;;
esac
BOAT

cat > "$temp/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail
[[ $PWD == "$sandbox/src/apps/mobile" && $EAS_PROJECT_ROOT == "$PWD" && $EXPO_TOKEN == fixture ]]
[[ $(cat ../../.env) == T3CODE_MOBILE_RUNTIME_VERSION=fixture-runtime ]]
[[ $* == "dlx eas-cli@27.10.0 update --platform android --channel fixture-channel --message $revision --non-interactive --json" ]]
if [[ ${expect_apk:-0} == 1 ]]; then [[ -f "$OUT/HomuCode-development-${revision:0:10}.apk" ]]; fi
echo publish >> "$trace"
if [[ ${fail_publish:-0} == 1 ]]; then echo 'fixture EAS failure' >&2; exit 9; fi
printf '[{"platform":"android","group":"fixture-group","runtimeVersion":"%s"}]\n' "${receipt_runtime:-fixture-runtime}"
PNPM
chmod +x "$temp/boat" "$temp/pnpm"
export T3_BUILD_BOAT_CLI="$temp/boat" SIGNING_DIR="$temp/signing" EXPO_TOKEN_FILE="$temp/token"
export HOMUCODE_ANDROID_ENV="$temp/android.env" fixture_pnpm="$temp/pnpm" VARIANT=development
export revision
revision=$(git -C "$repo" rev-parse HEAD)
run() {
  local scenario=$1
  shift
  export sandbox="$temp/$scenario-box" trace="$temp/$scenario-trace" OUT="$temp/$scenario-out"
  WORK="$temp/$scenario-work" "$@" > "$temp/$scenario.log" 2>&1
}
expect_apk=1 run release "$scripts/build.sh" HEAD
[[ $(<"$trace") == $'apk\ntoken\npublish\ndelete' ]]
grep -q 'PUBLISHED.*fixture-runtime' "$temp/release.log"

PUBLISH_OTA=0 run build-only "$scripts/build.sh" HEAD
[[ $(<"$trace") == $'apk\ndelete' ]]
if updates_enabled=false run updates-disabled "$scripts/build.sh" HEAD; then exit 1; fi
[[ $(<"$trace") == $'apk\ntoken\ndelete' ]]
grep -q 'Android OTA requires enabled updates' "$temp/updates-disabled-work/${revision:0:10}-development"/run.*/ota.log
run pre-eas "$scripts/build.sh" pre-eas
[[ $(<"$trace") == $'apk\ndelete' ]]
if run pre-eas-ota "$scripts/ota.sh" pre-eas; then exit 1; fi
[[ ! -e "$trace" ]]
run standalone "$scripts/ota.sh" HEAD
[[ $(<"$trace") == $'ota\ntoken\npublish\ndelete' ]]

if corrupt_apk=1 run corrupt-apk "$scripts/build.sh" HEAD; then exit 1; fi
[[ $(<"$trace") == $'apk\ndelete' && ! -d "$OUT" ]]

if receipt_runtime=wrong-runtime run mismatched-receipt "$scripts/build.sh" HEAD; then exit 1; fi
grep -q 'Published OTA receipt does not match' "$temp/mismatched-receipt.log"
if grep -q '^PUBLISHED ' "$temp/mismatched-receipt.log"; then exit 1; fi

if expect_apk=1 fail_publish=1 run publish-failed "$scripts/build.sh" HEAD; then exit 1; fi
[[ $(<"$trace") == $'apk\ntoken\npublish\ndelete' ]]
[[ -f "$OUT/HomuCode-development-${revision:0:10}.apk" ]]
grep -q 'OTA publish failed' "$temp/publish-failed.log"
grep -q 'Signed APK saved at' "$temp/publish-failed.log"
grep -q 'fixture EAS failure' "$temp/publish-failed-work/${revision:0:10}-development"/run.*/ota.log

cd "$repo"
packages="$temp/store"
modules=apps/mobile/node_modules
mkdir -p "$modules" "$packages/widgets" "$packages/expo/node_modules/@expo"
ln -s "$packages/widgets" "$modules/expo-widgets"
ln -s "$packages/expo" "$modules/expo"
printf '{"devDependencies":{"@expo/spawn-async":"1.8.0","resolve-workspace-root":"2.0.1"}}\n' > "$packages/widgets/package.json"
echo '{}' > "$packages/expo/package.json"
for dependency in '@expo/cli/node_modules/@expo/spawn-async' '@expo/config/node_modules/resolve-workspace-root'; do
  donor="$packages/expo/node_modules/${dependency%/node_modules/*}"
  installed="$packages/expo/node_modules/$dependency"
  mkdir -p "$installed"
  echo '{}' > "$donor/package.json"
  echo '{}' > "$installed/package.json"
  touch "$installed/index.js"
done
node "$here/link-widget-deps.cjs"
node "$here/link-widget-deps.cjs"
cat > "$packages/widgets/verify.mjs" <<'JS'
import "@expo/spawn-async";
import { createRequire } from "node:module";
createRequire(import.meta.url)("resolve-workspace-root");
JS
node "$packages/widgets/verify.mjs"
echo "Android release, OTA, and widget dependency fixtures passed."
