#!/usr/bin/env bash
# Builds a signed HomuCode Android APK on a fresh boat.dev box, brings it back, and deletes the box.
# Publishes an OTA for updates-enabled APKs on the same box after saving the signed APK.
# MODE=ota instead publishes REF's JS as an over-the-air update to installed APKs (see ota.sh).
# Usage: scripts/homu-android/build.sh [REF]   (default origin/main; run from pbox)
# Env: MODE (apk), PUBLISH_OTA (1; set 0 for APK only), VARIANT (development), APP_NAME (HomuCode), OUT (~/app/mobile),
#      SIGNING_DIR (~/credentials/android-signing), EXPO_TOKEN_FILE (~/credentials/expo/token),
#      WORK (~/hold/homu-android), HOMUCODE_ANDROID_ENV (config file with EAS owner and project ID)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(git -C "$here" rev-parse --show-toplevel)
MODE=${MODE:-apk}; [[ $MODE == apk || $MODE == ota ]]; VARIANT=${VARIANT:-development}; APP_NAME=${APP_NAME:-HomuCode}
PUBLISH_OTA=${PUBLISH_OTA:-1}; [[ $PUBLISH_OTA == 0 || $PUBLISH_OTA == 1 ]]
OUT=${OUT:-$HOME/app/mobile}; SIGNING_DIR=${SIGNING_DIR:-$HOME/credentials/android-signing}
EXPO_TOKEN_FILE=${EXPO_TOKEN_FILE:-$HOME/credentials/expo/token}
ref=${1:-origin/main}
[[ $ref == origin/* ]] && git -C "$repo" fetch -q origin "${ref#origin/}"
rev=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
eas_config=()
if git -C "$repo" grep -q T3CODE_EAS_PROJECT_ID "$rev" -- apps/mobile/app.config.ts; then
  eas_env=${HOMUCODE_ANDROID_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/homucode/android.env}
  if ! [[ -r "$eas_env" ]] ||
    ! eas_owner=$(grep -E '^T3CODE_EAS_OWNER=[[:alnum:]_-]+$' "$eas_env") ||
    ! eas_project=$(grep -E '^T3CODE_EAS_PROJECT_ID=[[:xdigit:]]{8}(-[[:xdigit:]]{4}){3}-[[:xdigit:]]{12}$' "$eas_env"); then
    printf 'Set T3CODE_EAS_OWNER and T3CODE_EAS_PROJECT_ID in %s before building.\n' "$eas_env" >&2
    exit 1
  fi
  eas_config=("$eas_owner" "$eas_project")
elif [[ $MODE == ota || $PUBLISH_OTA == 1 ]]; then
  printf 'This ref has no fork EAS configuration. Use an OTA-capable ref for releases or PUBLISH_OTA=0 for an APK-only build.\n' >&2
  exit 1
fi
suffix=$VARIANT; [[ $MODE == apk ]] || suffix+=-$MODE
work_root=${WORK:-$HOME/hold/homu-android}/${rev:0:10}-$suffix
mkdir -p "$work_root"
work=$(mktemp -d "$work_root/run.XXXXXX")
cd "$work"
git -C "$repo" archive --format=tar.gz -o "$work/source.tar.gz" "$rev"
(umask 077; { cat "$here/public.env"; printf '%s\n' "${eas_config[@]}"; } > "$work/public.env")
B=("${T3_BUILD_BOAT_CLI:-boat}" --no-update); R=/home/user/t3-preview
"${B[@]}" new --personal --type xlarge --no-env --no-snapshots --ttl 10800 --name "homucode-android-$MODE-${rev:0:10}" > box-create.json
box=$(grep -o '"id":"bx_[a-z0-9]*"' box-create.json | head -1 | cut -d'"' -f4); echo "$box" > box-id
echo "box $box, commit $rev, $MODE, variant $VARIANT, logs in $work"
trap '"${B[@]}" delete "$box" --yes > box-deletion.json 2>&1 || echo "box $box NOT deleted"' EXIT
"${B[@]}" ssh "$box" -- "mkdir -p $R/signing && chmod 700 $R/signing"
"${B[@]}" scp source.tar.gz "$box:$R/source-$rev.tar.gz"
for f in box-setup.sh box-build.sh link-widget-deps.cjs verify-apk-updates.py; do "${B[@]}" scp "$here/$f" "$box:$R/$f"; done
"${B[@]}" scp "$work/public.env" "$box:$R/public.env"
if [[ $MODE == ota ]]; then
  setup="NODE_SETUP_ONLY=1 bash $R/box-setup.sh"
else
  for f in t3-preview.p12 store-password; do "${B[@]}" scp "$SIGNING_DIR/$f" "$box:$R/signing/$f"; done
  setup="chmod 600 $R/signing/* && bash $R/box-setup.sh"
fi
"${B[@]}" ssh "$box" -- "$setup" > setup.log 2>&1
printf -v box_build 'bash %q %q %q %q' "$R/box-build.sh" "$rev" "$VARIANT" "$APP_NAME"
"${B[@]}" ssh "$box" -- "$box_build $MODE" > build.log 2>&1

for f in config.json runtime-version.json; do "${B[@]}" scp "$box:$R/artifacts/$f" "$f"; done
runtime=$(python3 -c 'import json; print(json.load(open("runtime-version.json"))["runtimeVersion"])')
publish_ota() {
  if ! {
    "${B[@]}" scp "$EXPO_TOKEN_FILE" "$box:$R/signing/expo-token" &&
      "${B[@]}" ssh "$box" -- "chmod 600 $R/signing/expo-token && $box_build publish"
  } > ota.log 2>&1; then
    printf 'OTA publish failed for %s (runtime %s). See %s/ota.log.\n' "$rev" "$runtime" "$work" >&2
    return 1
  fi
  if ! "${B[@]}" scp "$box:$R/artifacts/update.json" update.json; then
    printf 'OTA was published, but downloading its update receipt failed.\n' >&2
    return 1
  fi
  group=$(python3 - "$runtime" <<'PYTHON'
import json, sys
updates = json.load(open("update.json"))
match = next((update for update in updates if update.get("platform") == "android"), {})
if match.get("runtimeVersion") != sys.argv[1] or not match.get("group"):
    sys.exit("Published OTA receipt does not match the expected Android runtime.")
print(match["group"])
PYTHON
) || return 1
  echo "PUBLISHED $rev for runtime $runtime (group $group)"
}

if [[ $MODE == ota ]]; then
  publish_ota
  exit 0
fi
name="$APP_NAME-$VARIANT-${rev:0:10}.apk"
for f in app.apk app.apk.sha256 app.apk.badging.txt app.apk.signing.txt; do "${B[@]}" scp "$box:$R/artifacts/$f" "$f"; done
[ "$(cut -d' ' -f1 app.apk.sha256)" = "$(sha256sum app.apk | cut -d' ' -f1)" ]
mkdir -p "$OUT"
apk_output=$(mktemp "$OUT/.$name.XXXXXX")
cp app.apk "$apk_output"
chmod --reference=app.apk "$apk_output"
mv -f -- "$apk_output" "$OUT/$name"
echo "DONE $OUT/$name (runtime $runtime)"
if [[ $PUBLISH_OTA == 1 ]]; then
  publish_ota || { printf 'Signed APK saved at %s/%s.\n' "$OUT" "$name" >&2; exit 1; }
fi
